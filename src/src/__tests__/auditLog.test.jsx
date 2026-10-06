/**
 * THE AUDIT LOG ON SCREEN — who changed what, and why.
 *
 * The owner, 2026-10-04: "make sure that any action by an Engage admin on a
 * team or user is logged, and available [to see], with who did it." These
 * pin the seeing half: every entry shows who (and in what role), what
 * happened in plain words, the reason, what it touched and when; the log
 * pages; the three states say three different things; a team's owners see it
 * on Data & privacy and staff see it from Organisations.
 *
 * rejects: an entry drawn without who did it or why; a dotted action code on
 * screen; a reason truncated; "Show older" repeating or skipping entries; an
 * empty log and a failed load reading the same; the Data & privacy section
 * drawn with nothing wired behind it.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AuditLog, { AuditLogTable, AuditLogDialog } from '../components/AuditLog';
import PrivacyPanel from '../components/PrivacyPanel';
import PlatformOrgsPanel from '../components/PlatformOrgsPanel';
import {
  describeAction, roleLabel, actorLine, changeLine, targetTypeLabel, RETENTION_LINE,
} from '../utils/auditCopy';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
}));

const ORG = 'org_9xK4Fq7Pz2mNbVc8dQwLxR';
const entry = (n, over = {}) => ({
  id: `2026-10-0${n}T10:00:00.000Z#0000000${n}`,
  at: `2026-10-0${n}T10:00:00.000Z`,
  orgId: ORG,
  action: 'org.suspend',
  actor: { sub: 'sub-dai', email: 'dai@engage.example', name: 'Dai Staff', role: 'platform-admin' },
  target: { type: 'org', id: ORG, title: 'Northwind Learning' },
  reason: '',
  detail: { from: 'active', to: 'suspended' },
  outcome: '',
  ...over,
});

beforeEach(() => { window.API_BASE = 'https://api.test/'; });

describe('the words', () => {
  it('says each recorded action in plain words, never as a code', () => {
    expect(describeAction('user.approve')).toBe('Approved the account');
    expect(describeAction('org.suspend')).toBe('Suspended the organisation');
    expect(describeAction('billing.grant')).toBe('Added a billing adjustment');
    expect(describeAction('library.take-down')).toBe('Took a set down from the public library');
    expect(describeAction('session.delete')).toBe('Deleted a session');
    // An action this screen has not been taught still reads as words.
    expect(describeAction('widget.re-tune')).toBe('Widget: re tune');
  });

  it('names the role, and the email beside a name', () => {
    expect(roleLabel('platform-admin')).toBe('Engage staff');
    expect(roleLabel('org-owner')).toBe('Owner');
    expect(actorLine(entry(1))).toBe('Engage staff · dai@engage.example');
    expect(actorLine(entry(1, { actor: { email: 'x@y.example', role: 'host' } }))).toBe('Host');
  });

  it('shows a from-to change in words, and labels what was touched', () => {
    expect(changeLine(entry(1))).toBe('active → suspended');
    expect(changeLine(entry(1, { detail: { from: 'pending', to: 'hosts' } }))).toBe('waiting → host');
    expect(changeLine(entry(1, { detail: {} }))).toBe('');
    expect(targetTypeLabel('plan-request')).toBe('Plan request');
  });

  it('says how long entries are kept, once', () => {
    expect(RETENTION_LINE).toBe('Entries are kept for a year, then deleted.');
  });
});

describe('the table', () => {
  it('draws who, in what role, what happened, why, what it touched and when', () => {
    render(<div className="alog"><AuditLogTable entries={[entry(1, { reason: 'Phishing links in a public set.' })]} /></div>);
    const row = screen.getByTestId('alog-row');
    expect(within(row).getByText('Dai Staff')).toBeInTheDocument();
    expect(within(row).getByText('Engage staff · dai@engage.example')).toBeInTheDocument();
    expect(within(row).getByText('Suspended the organisation')).toBeInTheDocument();
    expect(within(row).getByText('active → suspended')).toBeInTheDocument();
    expect(within(row).getByText('“Phishing links in a public set.”')).toBeInTheDocument();
    expect(within(row).getByText('Northwind Learning')).toBeInTheDocument();
    expect(within(row).getByText('Organisation')).toBeInTheDocument();
    expect(row.querySelector('time').getAttribute('dateTime')).toBe('2026-10-01T10:00:00.000Z');
    expect(row.textContent).not.toMatch(/org\.suspend/);
  });

  it('says when an action did not go through', () => {
    render(<AuditLogTable entries={[entry(1, { outcome: 'failed' })]} />);
    expect(screen.getByText('Did not go through')).toBeInTheDocument();
  });

  it('keeps an empty log and a failed load apart', () => {
    const { rerender } = render(<AuditLogTable entries={[]} />);
    expect(screen.getByText('Nothing has been changed yet')).toBeInTheDocument();
    rerender(<AuditLogTable entries={[]} error="The server answered 500." />);
    expect(screen.getByRole('alert')).toHaveTextContent('The log could not be loaded');
    expect(screen.queryByText('Nothing has been changed yet')).toBeNull();
  });
});

describe('fetching and paging', () => {
  it('reads the path it is given, and "Show older" asks for the next page and appends it', async () => {
    const urls = [];
    global.fetch = jest.fn(async (url) => {
      urls.push(String(url));
      const second = String(url).includes('cursor=');
      return {
        ok: true,
        status: 200,
        json: async () => (second
          ? { entries: [entry(2), entry(1)], cursor: '' }
          : { entries: [entry(3), entry(2)], cursor: 'NEXT==' }),
      };
    });
    render(<AuditLog path={`orgs/${ORG}/audit`} />);
    await waitFor(() => expect(screen.getAllByTestId('alog-row')).toHaveLength(2));
    expect(urls[0]).toBe(`https://api.test/orgs/${ORG}/audit?limit=25`);
    const more = screen.getByRole('button', { name: 'Show older entries' });
    fireEvent.click(more);
    await waitFor(() => expect(screen.getAllByTestId('alog-row')).toHaveLength(3));
    expect(urls[1]).toBe(`https://api.test/orgs/${ORG}/audit?limit=25&cursor=NEXT%3D%3D`);
    // No repeats, newest first, and no pager once the log has run out.
    const times = screen.getAllByTestId('alog-row').map((r) => r.querySelector('time').getAttribute('dateTime'));
    expect(times).toEqual([entry(3).at, entry(2).at, entry(1).at]);
    expect(screen.queryByRole('button', { name: 'Show older entries' })).toBeNull();
  });

  it('shows the server\'s refusal as a failed load', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Only an admin of this organisation can do this.' }) }));
    render(<AuditLog path={`orgs/${ORG}/audit`} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Only an admin of this organisation can do this.');
  });
});

describe('where it is shown', () => {
  it('Data & privacy draws the section, with the retention line, only when a log is wired', () => {
    const { rerender } = render(<PrivacyPanel org={{ id: ORG, name: 'Northwind' }} />);
    expect(screen.queryByText('Who changed what')).toBeNull();
    rerender(<PrivacyPanel org={{ id: ORG, name: 'Northwind' }} activity={<p>the log</p>} />);
    expect(screen.getByText('Who changed what')).toBeInTheDocument();
    expect(screen.getByText(/Entries are kept for a year, then deleted\./)).toBeInTheDocument();
    expect(screen.getByText('the log')).toBeInTheDocument();
  });

  it('AdminPage wires Data & privacy to this organisation\'s own log route', () => {
    // AdminPage cannot be mounted in jsdom (useAuth throws), so its source is read.
    // eslint-disable-next-line global-require
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'AdminPage.jsx'), 'utf8');
    expect(src).toMatch(/activity=\{<AuditLog path=\{`orgs\/\$\{encodeURIComponent\(activeOrg\.orgId\)\}\/audit`\} \/>\}/);
  });

  it('the staff dialog reads one organisation\'s log from the platform route, and closes', async () => {
    const urls = [];
    global.fetch = jest.fn(async (url) => { urls.push(String(url)); return { ok: true, status: 200, json: async () => ({ entries: [entry(1)], cursor: '' }) }; });
    const onClose = jest.fn();
    render(<AuditLogDialog org={{ orgId: ORG, name: 'Northwind' }} onClose={onClose} />);
    await screen.findByTestId('alog-row');
    expect(urls[0]).toBe(`https://api.test/platform/audit?orgId=${ORG}&limit=25`);
    expect(screen.getByText(/Northwind: who changed what/)).toBeInTheDocument();
    // Two exits, both live: the X and the bottom Close.
    const exits = screen.getAllByRole('button', { name: 'Close' });
    expect(exits).toHaveLength(2);
    exits.forEach((b) => fireEvent.click(b));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Organisations opens a row\'s activity, and staff activity across the platform with org names', async () => {
    const orgs = [{ orgId: ORG, name: 'Northwind Learning', plan: 'team', type: 'team', status: 'active', members: 2 }];
    const urls = [];
    global.fetch = jest.fn(async (url) => {
      urls.push(String(url));
      if (String(url).includes('platform/audit')) {
        return { ok: true, status: 200, json: async () => ({ entries: [entry(1, { target: { type: 'code', id: 'SPRING', title: 'SPRING' } })], cursor: '' }) };
      }
      return { ok: true, status: 200, json: async () => ({ orgs, counts: { teams: 1, personal: 0, suspended: 0, pending: 0 } }) };
    });
    render(<PlatformOrgsPanel />);
    fireEvent.click(await screen.findByTestId('porgs-activity'));
    await screen.findByTestId('alog-row');
    expect(urls.some((u) => u.endsWith(`platform/audit?orgId=${ORG}&limit=25`))).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.queryByTestId('alog-row')).toBeNull());
    fireEvent.click(screen.getByTestId('porgs-staff-activity'));
    const row = await screen.findByTestId('alog-row');
    expect(urls.some((u) => u.endsWith('platform/audit?limit=25'))).toBe(true);
    expect(within(row).getByText('Northwind Learning')).toBeInTheDocument();
  });
});
