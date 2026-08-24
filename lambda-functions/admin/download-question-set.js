const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { resolvePartitionFromMeta } = require('./shared/set-version');
const { findSetForCaller, requestedScope } = require('./shared/question-set-access');
const { ORG } = require('./shared/tenant');
const { decryptItem, decryptItems } = require('./shared/tenant-crypto');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  try {
    const setId = event.pathParameters?.setId;
    const format = event.queryStringParameters?.format || 'auto'; // 'csv', 'json', or 'auto'
    // Optional `?version=2` to export an OLD version — the download half of
    // rollback: fetch what v2 said, edit it, upload it back as a new version.
    // Omitted means the active version, falling through to legacy.
    const requestedVersion = event.queryStringParameters?.version;

    console.log(`Downloading question set ${setId} in format: ${format}`);
    
    if (!setId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Set ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    // Get question set metadata — from a library this caller may READ.
    //
    // A read, so the guard is readability rather than manageability: every org
    // is meant to be able to take a copy of the shared platform library, and no
    // org user may MANAGE a platform set, so requireSetManager would refuse
    // exactly the callers this route exists for. Another organisation's set is
    // never probed, so it 404s here like a set that does not exist.
    const found = await findSetForCaller(
      db, process.env.TABLE_NAME, event, setId, requestedScope(event)
    );
    const metaRes = { Item: found && found.item };
    
    if (!metaRes.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Question set not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    // ── THE EXPORT IS THE ROUND TRIP, SO IT MUST BE PLAINTEXT ────────────────
    //
    // This file is downloaded, edited in a spreadsheet and uploaded back as a
    // new version. A CSV cell containing `{"v":1,"iv":…}` would not merely look
    // wrong — upload-questions.js would re-import it as the literal question
    // title, so one export/import cycle would permanently replace a set's
    // content with its own envelopes.
    //
    // Only org content is decrypted, because only org content was ever
    // encrypted. `found.ref` is the library the row was actually read from.
    const cryptoOrgId = found.ref && found.ref.scope === ORG ? String(found.ref.orgId || '') : '';
    const metadata = cryptoOrgId
      ? await decryptItem(cryptoOrgId, 'set', metaRes.Item)
      : metaRes.Item;
    const setName = metadata.name || metadata.Name;
    const engagementType = metadata.engagementType || metadata.EngagementType || 'call-and-answer';
    
    // Get all questions for the resolved version of this set. The download must
    // reflect the SAME rows a game would be served, or the round trip
    // (download -> edit -> upload as a new version) silently reverts to
    // whatever the legacy partition still holds.
    const resolved = resolvePartitionFromMeta(found.ref, metadata, requestedVersion);

    const questionsRes = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :setpk AND begins_with(SK, :questionPrefix)',
      ExpressionAttributeValues: {
        ':setpk': resolved.pk,
        ':questionPrefix': 'QUESTION#'
      }
    }));
    
    // Same reasoning as the metadata above: every exporter below reads Title,
    // Detail, optionA..F, AnswerDetails and CustomInstructions straight out of
    // these rows and writes them into a cell.
    const questions = cryptoOrgId
      ? await decryptItems(cryptoOrgId, 'question', questionsRes.Items || [])
      : (questionsRes.Items || []);

    // Determine output format based on engagement type and user preference
    let outputFormat = format;
    if (format === 'auto') {
      // CSV for simple types, JSON for complex types
      outputFormat = (engagementType === 'survey' || engagementType === 'mixed') ? 'json' : 'csv';
    }
    
    console.log(`Exporting ${questions.length} questions as ${outputFormat} for engagement type: ${engagementType}`);
    
    if (outputFormat === 'json') {
      // JSON export - full data structure
      const jsonData = {
        metadata: {
          setId: setId,
          name: setName,
          description: metadata.description || metadata.Description || '',
          engagementType: engagementType,
          customInstruction: metadata.customInstruction || metadata.CustomInstruction || '',
          aiContextInstruction: metadata.aiContextInstruction || metadata.AIContextInstruction || '',
          createdAt: metadata.createdAt || metadata.CreatedAt,
          version: resolved.version,
          questionCount: questions.length
        },
        questions: questions.map(q => ({
          id: q.SK,
          title: q.Title || q.title,
          detail: q.Detail || q.detail || '',
          category: q.Category || q.category,
          school: q.School || q.school || '',
          customInstructions: q.CustomInstructions || q.customInstructions || '',
          // Include all question-specific fields
          ...Object.fromEntries(
            Object.entries(q).filter(([key]) => 
              !['PK', 'SK', 'Title', 'Detail', 'Category', 'School', 'CustomInstructions'].includes(key)
            )
          )
        }))
      };
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          filename: `${setName.replace(/[^a-zA-Z0-9-_]/g, '_')}.json`,
          content: JSON.stringify(jsonData, null, 2),
          contentType: 'application/json'
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    } else {
      // CSV export - structured for re-import
      //
      // THE ONE RULE FOR THIS WHOLE BLOCK: **upload-questions.js is the
      // contract.** Every column emitted here must be a column the importer
      // actually reads, spelled the way the importer spells it. Its
      // `getColumnIndex` is an exact case-insensitive match, and its generic
      // fallback block covers exactly nine columns — Category, Title,
      // QuestionDetail, AnswerDetails, Detail, School, CustomInstruction, Image,
      // Tags — and NO option column of any kind. So a header this file invents
      // is not "mostly right", it is silently dropped on the way back in.
      //
      // That is not hypothetical. This file used to emit
      // `CorrectAnswer,WrongAnswer1,WrongAnswer2,WrongAnswer3` for trivia,
      // filled from optionA/B/C — a header the importer has never read, with
      // optionD/E/F thrown away before it even mattered — and it read the
      // capitalised `q.Options` for polls, an attribute the importer never
      // writes (it writes lower-case `options`), so the column came out empty.
      // Download a trivia or poll set, fix a typo, upload it back: every
      // question lost every answer, with a 200 and a success message.
      //
      // Sibling warning, same contract, do not undo either half:
      // AdminPage.jsx's generatePollCSV — "Do not 'restore' the numbered
      // columns". Proof for this half: tests/question-set-roundtrip.js.
      let csvContent = '';

      // Pipe-separated, matching the Options column's convention that
      // upload-questions.js already parses (tagsCell.split('|')).
      const tagsOf = (q) => (Array.isArray(q.Tags) ? q.Tags.join('|') : (q.Tags || ''));
      const esc = (v) => String(v ?? '').replace(/"/g, '""');
      // The STORED question number, never a fresh index. A set's numbering is
      // category-relative (1,2 in one category and 1,2 in the next), and
      // renumbering it globally on export made the next import rewrite it to
      // 1,2,3,4 — a quiet reordering of somebody's set on a round trip that
      // changed nothing. `index + 1` is only a floor for legacy rows that
      // predate the attribute.
      const numberOf = (q, index) => q.QuestionNumber ?? q.questionNumber ?? (index + 1);
      // Optional columns, emitted only when the set actually uses them, so an
      // ordinary set's CSV keeps its familiar shape. Both are read by the
      // importer for EVERY engagement type, not just call-and-answer.
      //
      // RoundKind and SourceAttribution join the same pattern. RoundKind is the
      // per-question OVERRIDE of the set's direction and SourceAttribution is
      // whose material an Apply question carries; both are absent from every
      // set written before this slice, so both columns simply do not appear on
      // an ordinary set's CSV. A column the importer reads and the exporter
      // never emits is destroyed by the next replace — that is precisely the
      // defect the round trip was just repaired for, so these two are wired on
      // BOTH sides in the same change and asserted in
      // tests/question-set-roundtrip.js.
      //
      // SourceSetId / SourceQuestionSk join them on the same terms. They are
      // PROVENANCE, never identity (decision 2): stamped when a question is
      // copied out of another set, read by nothing, propagated to nothing. They
      // are emitted here for one reason — a column the importer reads and this
      // file does not emit is destroyed by the next replace, in silence, which
      // is precisely the defect this block was rewritten to end.
      const carriesImages = questions.some(q => String(q.Image || q.image || '').trim());
      const carriesAnswerDetails = questions.some(q => String(q.AnswerDetails || q.answerDetails || '').trim());
      const carriesRoundKind = questions.some(q => String(q.RoundKind || q.roundKind || '').trim());
      const carriesAttribution = questions.some(q => String(q.SourceAttribution || q.sourceAttribution || '').trim());
      const carriesSourceSet = questions.some(q => String(q.SourceSetId || q.sourceSetId || '').trim());
      const carriesSourceSk = questions.some(q => String(q.SourceQuestionSk || q.sourceQuestionSk || '').trim());
      const optionalHeader = (carriesAnswerDetails ? ',AnswerDetails' : '') + (carriesImages ? ',Image' : '')
        + (carriesRoundKind ? ',RoundKind' : '') + (carriesAttribution ? ',SourceAttribution' : '')
        + (carriesSourceSet ? ',SourceSetId' : '') + (carriesSourceSk ? ',SourceQuestionSk' : '');
      const optionalCells = (q) =>
        (carriesAnswerDetails ? `,"${esc(q.AnswerDetails || q.answerDetails)}"` : '')
        + (carriesImages ? `,"${esc(q.Image || q.image)}"` : '')
        + (carriesRoundKind ? `,"${esc(q.RoundKind || q.roundKind)}"` : '')
        + (carriesAttribution ? `,"${esc(q.SourceAttribution || q.sourceAttribution)}"` : '')
        + (carriesSourceSet ? `,"${esc(q.SourceSetId || q.sourceSetId)}"` : '')
        + (carriesSourceSk ? `,"${esc(q.SourceQuestionSk || q.sourceQuestionSk)}"` : '');

      if (engagementType === 'trivia') {
        // OptionA..OptionF, which is what the importer reads and what every
        // hand-authored set in sets/, download-template.js and the trivia AI
        // builder (AdminPage.jsx / TriviaAIBuilder.jsx) already emit. All six
        // are emitted even when empty: the stored row always has all six, so
        // round-tripping the empties is what keeps the export byte-stable.
        csvContent = 'Category,Question#,Title,QuestionDetail,School,CustomInstruction,'
          + 'OptionA,OptionB,OptionC,OptionD,OptionE,OptionF,CorrectAnswer,Difficulty'
          + optionalHeader
          + ',Tags'
          + '\n';
        questions.forEach((q, index) => {
          // The stored attributes are LOWER-case (optionA, correctAnswer,
          // difficulty) — confirmed against real rows in engagedev. The
          // capitalised reads are the tolerant half, for anything hand-written.
          const options = ['A', 'B', 'C', 'D', 'E', 'F']
            .map((letter) => `,"${esc(q[`Option${letter}`] || q[`option${letter}`])}"`)
            .join('');

          csvContent += `"${esc(q.Category || q.category)}",${numberOf(q, index)},`
            + `"${esc(q.Title || q.title)}","${esc(q.Detail || q.detail)}",`
            + `"${esc(q.School || q.school)}","${esc(q.CustomInstructions || q.customInstructions)}"`
            + options
            + `,"${esc(q.CorrectAnswer || q.correctAnswer)}"`
            + `,"${esc(q.Difficulty || q.difficulty || 'medium')}"`
            + optionalCells(q)
            + `,"${tagsOf(q)}"`
            + '\n';
        });
      } else if (engagementType === 'poll') {
        csvContent = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Options,AllowMultiple'
          + optionalHeader
          + ',Tags'
          + '\n';
        questions.forEach((q, index) => {
          // LOWER-case `options` is what the importer writes; the capitalised
          // read is the tolerant half. Reading only `q.Options` exported an
          // empty column for every poll set in the product.
          const rawOptions = q.options ?? q.Options;
          const options = Array.isArray(rawOptions) ? rawOptions.join('|') : (rawOptions || '');
          const allowMultiple = q.AllowMultiple ?? q.allowMultiple ?? false;

          csvContent += `"${esc(q.Category || q.category)}",${numberOf(q, index)},`
            + `"${esc(q.Title || q.title)}","${esc(q.Detail || q.detail)}",`
            + `"${esc(q.School || q.school)}","${esc(q.CustomInstructions || q.customInstructions)}"`
            + `,"${esc(options)}","${allowMultiple === true || allowMultiple === 'true'}"`
            + optionalCells(q)
            + `,"${tagsOf(q)}"`
            + '\n';
        });
      } else {
        // call-and-answer (default)
        //
        // Art-title sets are call-and-answer sets that carry two extra columns:
        // Image (the artwork) and AnswerDetails (the real title + a point of
        // trivia, revealed only by the AI summary at RESULTS). Exporting the
        // fixed six columns silently dropped both, so download → edit → re-upload
        // destroyed the artwork and the reveal. Emit them only when the set
        // actually has them, so an ordinary set keeps its familiar shape.
        //
        // WAVELENGTH RIDES THIS BRANCH TOO, and correctly: a wavelength question
        // row carries no type-specific attribute at all — only the shared
        // Title/Detail/Category/School/CustomInstructions/Tags set (confirmed
        // against engagedev). The importer likewise has no wavelength branch. So
        // these six-plus-optional columns are the whole of a wavelength question,
        // and a wavelength-specific export branch would only be a new way to emit
        // columns nothing reads.
        csvContent = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction'
          + optionalHeader
          + ',Tags'
          + '\n';
        questions.forEach((q, index) => {
          csvContent += `"${esc(q.Category || q.category)}",${numberOf(q, index)},`
            + `"${esc(q.Title || q.title)}","${esc(q.Detail || q.detail)}",`
            + `"${esc(q.School || q.school)}","${esc(q.CustomInstructions || q.customInstructions)}"`
            + optionalCells(q)
            + `,"${tagsOf(q)}"`
            + '\n';
        });
      }
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          filename: `${setName.replace(/[^a-zA-Z0-9-_]/g, '_')}.csv`,
          content: csvContent,
          contentType: 'text/csv'
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
  } catch (error) {
    console.error('Download question set error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to download question set: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};