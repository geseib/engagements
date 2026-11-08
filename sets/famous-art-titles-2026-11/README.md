# Famous Art Titles: neutral-named images

The images for Engage's **Famous Art Titles** Call & Answer set (`famousarttitles`,
platform `SETS` library), re-hosted under neutral names. Only the Image URLs changed.

## Why

The set's Image URLs were Wikimedia Commons `Special:FilePath/<filename>` links, and the
filenames named the painting (`Mona_Lisa,_by_Leonardo_da_Vinci…`,
`Van_Gogh_-_Starry_Night…`). The Image URL is in the public question payload
(`game/get-question.js` sends `image`), so a player who long-pressed the picture or opened
it in a new tab could read the real title. This is the same leak the What Is This Thing?
review found (`sets/call-answer-2026-11/QA-NOTES.md`), fixed the same way.

## Files

| File | What it is |
|---|---|
| `images/fat-01.jpg` … `fat-60.jpg` | The original 60 paintings, numbered in shuffled order (the number does not follow question order) |
| `images/fat-61.jpg` … `fat-63.jpg` | The three replacements from round 2 (see below) |
| `famous-art-titles-dev-v5.csv`, `-test-v2.csv` | Round 1: neutral images only, as installed on dev v5 and test v2 |
| `famous-art-titles-dev-v6.csv`, `-test-v3.csv`, `-prod-v2.csv` | Round 2: the three swaps, plus prod's images, as installed on dev v6, test v3 and prod v2 |
| `famous-art-titles-images.json` | Per image: the dev question it belongs to, the work, whether it is also on test, Commons file and page, licence, the URL it was fetched from, source and saved size. Round 2 entries also say which image they replace and which Wikipedia article the facts were checked against |
| `image-check-dev.json`, `-test.json`, `-prod.json` | The URL check after the round-2 upload: status, content type, bytes, and whether the served bytes equal the local file |
| `INSTALLED.md` | Where it is installed and how it read back |

The CSVs were written from the **live** active version on each tier (not from
`sets/famous-art-titles.csv`, which no longer matches either tier), with every column
copied as stored except Image. Dev and test hold different content (see INSTALLED.md), so
there is one CSV per tier.

## How the images were made

- Downloaded from Wikimedia Commons, paced, with a generic User-Agent naming no person.
  `upload.wikimedia.org` answered this egress with 429s after the first 27 files, so the
  other 33 came from Commons' own `w/thumb.php` at 1280 px (`fetched` in the JSON says which).
- Orientation applied from EXIF, resized to a long side of at most 1600 px (never upscaled),
  saved as baseline-progressive JPEG quality 85 by Pillow, with no EXIF or comment metadata.
  Long sides run from 960 px (the two Kandinskys, whose Commons files are only ~1000 px) to 1600 px.
- Every image was looked at. None carries a frame label, museum caption or added text.
  Three paintings carry text **painted into the work itself**, which was left alone (see
  "Known gaps").

## One image is new, not just re-hosted

The Nightmare (dev only) pointed at `File:The_Nightmare.jpg`, which is not Fuseli's
painting: it is a 596 px CC BY-SA 4.0 photograph by Lieve Prins of a different work. It now
shows Fuseli's 1781 painting (Detroit Institute of Arts) from
`File:John_Henry_Fuseli_-_The_Nightmare.JPG` (public domain). That is the work the row's
Title and AnswerDetails describe.

## Round 2 (8 Nov 2026): three paintings swapped, and prod gets images

The owner approved two more changes.

**1. Three paintings swapped out.** Each had its title or subject painted into the image.
Each was replaced with a well-known public-domain painting that has no title in it. The
replacement gets a new file number, so old versions keep loading their own image.

| Out | In | Tiers | Category |
|---|---|---|---|
| `fat-60` Gauguin, *Ia Orana Maria* ("IA ORANA MARIA" painted on it) | `fat-63` Caillebotte, *Paris Street; Rainy Day*, 1877 | dev | Impressionism & Post-Impressionism (unchanged) |
| `fat-28` David, *The Death of Marat* ("À MARAT" on the crate) | `fat-61` Gainsborough, *The Blue Boy*, c. 1770 | dev | Baroque, Rococo & Neoclassicism (unchanged) |
| `fat-17` Hokusai, *The Great Wave* (title cartouche) | `fat-62` Hasegawa Tōhaku, *Pine Trees* screen, c. 1595 (left-hand screen) | dev, test, prod | dev: Asian Art (unchanged). test and prod: **Ukiyo-e → Asian Art** |

- **Fields changed on each swapped row:** Title (in the style of that tier's other rows),
  AnswerDetails ("Real title: …" plus a short story), and Image.
  - Test's row also gets the artist in School, as its other rows have.
  - Prod's row also gets a new CustomInstruction. Every prod row has a hint written for its
    own painting, and the old one described the Great Wave's boats.
  - Prod's row is the only prod row with AnswerDetails, because the other nine have none.
  - No tier has a RealAnswer column.
- **Category change on test and prod:** the Pine Trees screen is a Momoyama ink painting, not
  ukiyo-e, so that row's category on test and prod becomes "Asian Art", which is dev's name
  for it. A text-free ukiyo-e was not used because famous ukiyo-e prints nearly always carry
  a title cartouche, and the obvious cartouche-free ukiyo-e painting (Moronobu's *Beauty
  Looking Back*) has no en.wikipedia article to check facts against.
- **Facts:** checked against the en.wikipedia articles "Paris Street; Rainy Day", "The Blue
  Boy" and "Shōrin-zu byōbu".
- **Images viewed:** none has a title in it. Caillebotte signed lower left, and the Tōhaku
  screen carries two small artist's seals at its left edge. Neither names the work.

**2. Prod gets images.** Prod's copy (`famousarttitlesimported20260815`) had a blank Image
on every row. Its round-2 CSV gives every row the same neutral image as the matching row
on test (matched on the teaser Title, which is identical on both tiers), served from
`engage.seibtribe.us`. Nothing else on those rows changes.

## Licence

Every file used is marked **Public domain** on its Commons page; that marking is recorded
per file in the JSON. Only the short licence name was read, not the full tag. Some
20th-century works (Hopper 1942, Wood 1930, Mondrian 1930) may be public domain on
US-specific grounds, so read each Commons page's tag before reusing them outside Engage.

## Sources

| Image | Work (post-reveal only) | Commons file | Licence on Commons |
|---|---|---|---|
| `fat-01.jpg` | The Calling of Saint Matthew | [The Calling of Saint Matthew-Caravaggo (1599-1600).jpg](https://commons.wikimedia.org/wiki/File:The_Calling_of_Saint_Matthew-Caravaggo_(1599-1600).jpg) | Public domain |
| `fat-02.jpg` | Café Terrace at Night | [Vincent Willem van Gogh - Cafe Terrace at Night (Yorck).jpg](https://commons.wikimedia.org/wiki/File:Vincent_Willem_van_Gogh_-_Cafe_Terrace_at_Night_(Yorck).jpg) | Public domain |
| `fat-03.jpg` | The Child's Bath | [Mary Cassatt - The Child's Bath - Google Art Project.jpg](https://commons.wikimedia.org/wiki/File:Mary_Cassatt_-_The_Child%27s_Bath_-_Google_Art_Project.jpg) | Public domain |
| `fat-04.jpg` | The School of Athens | [The School of Athens by Raffaello Sanzio da Urbino.jpg](https://commons.wikimedia.org/wiki/File:The_School_of_Athens_by_Raffaello_Sanzio_da_Urbino.jpg) | Public domain |
| `fat-05.jpg` | A Burial at Ornans | [Gustave Courbet - A Burial at Ornans - Google Art Project 2.jpg](https://commons.wikimedia.org/wiki/File:Gustave_Courbet_-_A_Burial_at_Ornans_-_Google_Art_Project_2.jpg) | Public domain |
| `fat-06.jpg` | The Birth of Venus | [Sandro Botticelli - La nascita di Venere - Google Art Project - edited.jpg](https://commons.wikimedia.org/wiki/File:Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg) | Public domain |
| `fat-07.jpg` | The Last Supper | [The Last Supper - Leonardo Da Vinci - High Resolution 32x16.jpg](https://commons.wikimedia.org/wiki/File:The_Last_Supper_-_Leonardo_Da_Vinci_-_High_Resolution_32x16.jpg) | Public domain |
| `fat-08.jpg` | The Card Players | [Les Joueurs de cartes, par Paul Cézanne.jpg](https://commons.wikimedia.org/wiki/File:Les_Joueurs_de_cartes,_par_Paul_C%C3%A9zanne.jpg) | Public domain |
| `fat-09.jpg` | The Ballet Class | [Edgar Degas - The Ballet Class - Google Art Project.jpg](https://commons.wikimedia.org/wiki/File:Edgar_Degas_-_The_Ballet_Class_-_Google_Art_Project.jpg) | Public domain |
| `fat-10.jpg` | Breezing Up (A Fair Wind) | [Winslow Homer - Breezing Up (A Fair Wind) - Google Art Project.jpg](https://commons.wikimedia.org/wiki/File:Winslow_Homer_-_Breezing_Up_(A_Fair_Wind)_-_Google_Art_Project.jpg) | Public domain |
| `fat-11.jpg` | Composition VII | [Vassily Kandinsky, 1913 - Composition 7.jpg](https://commons.wikimedia.org/wiki/File:Vassily_Kandinsky,_1913_-_Composition_7.jpg) | Public domain |
| `fat-12.jpg` | Composition 8 | [Vassily Kandinsky, 1923 - Composition 8, huile sur toile, 140 cm x 201 cm, Musée Guggenheim, New York.jpg](https://commons.wikimedia.org/wiki/File:Vassily_Kandinsky,_1923_-_Composition_8,_huile_sur_toile,_140_cm_x_201_cm,_Mus%C3%A9e_Guggenheim,_New_York.jpg) | Public domain |
| `fat-13.jpg` | The Creation of Adam | [Michelangelo - Creation of Adam (cropped).jpg](https://commons.wikimedia.org/wiki/File:Michelangelo_-_Creation_of_Adam_(cropped).jpg) | Public domain |
| `fat-14.jpg` | Arrangement in Grey and Black No. 1 | [Whistlers Mother high res.jpg](https://commons.wikimedia.org/wiki/File:Whistlers_Mother_high_res.jpg) | Public domain |
| `fat-15.jpg` | Impression | [Claude Monet, Impression, soleil levant.jpg](https://commons.wikimedia.org/wiki/File:Claude_Monet,_Impression,_soleil_levant.jpg) | Public domain |
| `fat-16.jpg` | American Gothic | [Grant DeVolson Wood - American Gothic.jpg](https://commons.wikimedia.org/wiki/File:Grant_DeVolson_Wood_-_American_Gothic.jpg) | Public domain |
| `fat-17.jpg` | The Great Wave off Kanagawa (Under the Wave off Kanagawa) | [The Great Wave off Kanagawa.jpg](https://commons.wikimedia.org/wiki/File:The_Great_Wave_off_Kanagawa.jpg) | Public domain |
| `fat-18.jpg` | Dance at Le Moulin de la Galette | [Pierre-Auguste Renoir, Le Moulin de la Galette.jpg](https://commons.wikimedia.org/wiki/File:Pierre-Auguste_Renoir,_Le_Moulin_de_la_Galette.jpg) | Public domain |
| `fat-19.jpg` | Portrait of Adele Bloch-Bauer I | [Gustav Klimt 046.jpg](https://commons.wikimedia.org/wiki/File:Gustav_Klimt_046.jpg) | Public domain |
| `fat-20.jpg` | Nighthawks | [Nighthawks by Edward Hopper 1942.jpg](https://commons.wikimedia.org/wiki/File:Nighthawks_by_Edward_Hopper_1942.jpg) | Public domain |
| `fat-21.jpg` | The Swing | [Jean-Honoré Fragonard - The Swing - Google Art Project.jpg](https://commons.wikimedia.org/wiki/File:Jean-Honor%C3%A9_Fragonard_-_The_Swing_-_Google_Art_Project.jpg) | Public domain |
| `fat-22.jpg` | Blue Horse I | [Franz Marc 005.jpg](https://commons.wikimedia.org/wiki/File:Franz_Marc_005.jpg) | Public domain |
| `fat-23.jpg` | A Sunday Afternoon on the Island of La Grande Jatte | [A Sunday on La Grande Jatte, Georges Seurat, 1884.jpg](https://commons.wikimedia.org/wiki/File:A_Sunday_on_La_Grande_Jatte,_Georges_Seurat,_1884.jpg) | Public domain |
| `fat-24.jpg` | A Bar at the Folies-Bergère | [Edouard Manet 004.jpg](https://commons.wikimedia.org/wiki/File:Edouard_Manet_004.jpg) | Public domain |
| `fat-25.jpg` | The Dream | [Henri Rousseau 005.jpg](https://commons.wikimedia.org/wiki/File:Henri_Rousseau_005.jpg) | Public domain |
| `fat-26.jpg` | Tiger in a Tropical Storm (Surprised!) | [Surprised-Rousseau.jpg](https://commons.wikimedia.org/wiki/File:Surprised-Rousseau.jpg) | Public domain |
| `fat-27.jpg` | The Oath of the Horatii | [Jacques-Louis David, Le Serment des Horaces.jpg](https://commons.wikimedia.org/wiki/File:Jacques-Louis_David,_Le_Serment_des_Horaces.jpg) | Public domain |
| `fat-28.jpg` | The Death of Marat | [Jacques-Louis David - Marat assassinated - Google Art Project 2.jpg](https://commons.wikimedia.org/wiki/File:Jacques-Louis_David_-_Marat_assassinated_-_Google_Art_Project_2.jpg) | Public domain |
| `fat-29.jpg` | The Nightmare | [John Henry Fuseli - The Nightmare.JPG](https://commons.wikimedia.org/wiki/File:John_Henry_Fuseli_-_The_Nightmare.JPG) | Public domain |
| `fat-30.jpg` | View of Delft | [Vermeer-view-of-delft.jpg](https://commons.wikimedia.org/wiki/File:Vermeer-view-of-delft.jpg) | Public domain |
| `fat-31.jpg` | Mona Lisa (La Gioconda) | [Mona Lisa, by Leonardo da Vinci, from C2RMF retouched.jpg](https://commons.wikimedia.org/wiki/File:Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg) | Public domain |
| `fat-32.jpg` | The Anatomy Lesson of Dr. Nicolaes Tulp | [Rembrandt - The Anatomy Lesson of Dr Nicolaes Tulp.jpg](https://commons.wikimedia.org/wiki/File:Rembrandt_-_The_Anatomy_Lesson_of_Dr_Nicolaes_Tulp.jpg) | Public domain |
| `fat-33.jpg` | The Ambassadors | [Hans Holbein the Younger - The Ambassadors - Google Art Project.jpg](https://commons.wikimedia.org/wiki/File:Hans_Holbein_the_Younger_-_The_Ambassadors_-_Google_Art_Project.jpg) | Public domain |
| `fat-34.jpg` | Sunflowers | [Vincent Willem van Gogh 127.jpg](https://commons.wikimedia.org/wiki/File:Vincent_Willem_van_Gogh_127.jpg) | Public domain |
| `fat-35.jpg` | The Arnolfini Portrait | [Van Eyck - Arnolfini Portrait.jpg](https://commons.wikimedia.org/wiki/File:Van_Eyck_-_Arnolfini_Portrait.jpg) | Public domain |
| `fat-36.jpg` | Snow Storm: Steam-Boat off a Harbour’s Mouth | [Joseph Mallord William Turner - Snow Storm - Steam-Boat off a Harbour's Mouth - WGA23178.jpg](https://commons.wikimedia.org/wiki/File:Joseph_Mallord_William_Turner_-_Snow_Storm_-_Steam-Boat_off_a_Harbour%27s_Mouth_-_WGA23178.jpg) | Public domain |
| `fat-37.jpg` | The Great Red Dragon and the Woman Clothed in Sun | [William Blake 003.jpg](https://commons.wikimedia.org/wiki/File:William_Blake_003.jpg) | Public domain |
| `fat-38.jpg` | The Scream | [The Scream.jpg](https://commons.wikimedia.org/wiki/File:The_Scream.jpg) | Public domain |
| `fat-39.jpg` | Washington Crossing the Delaware | [Washington Crossing the Delaware by Emanuel Leutze, MMA-NYC, 1851.jpg](https://commons.wikimedia.org/wiki/File:Washington_Crossing_the_Delaware_by_Emanuel_Leutze,_MMA-NYC,_1851.jpg) | Public domain |
| `fat-40.jpg` | The Garden of Earthly Delights | [The Garden of Earthly Delights by Bosch High Resolution.jpg](https://commons.wikimedia.org/wiki/File:The_Garden_of_Earthly_Delights_by_Bosch_High_Resolution.jpg) | Public domain |
| `fat-41.jpg` | The Milkmaid | [Johannes Vermeer - Het melkmeisje - Google Art Project.jpg](https://commons.wikimedia.org/wiki/File:Johannes_Vermeer_-_Het_melkmeisje_-_Google_Art_Project.jpg) | Public domain |
| `fat-42.jpg` | Woman with a Parasol – Madame Monet and Her Son | [Claude Monet - Woman with a Parasol - Madame Monet and Her Son - Google Art Project.jpg](https://commons.wikimedia.org/wiki/File:Claude_Monet_-_Woman_with_a_Parasol_-_Madame_Monet_and_Her_Son_-_Google_Art_Project.jpg) | Public domain |
| `fat-43.jpg` | Saturn Devouring His Son | [Francisco de Goya, Saturno devorando a su hijo (1819-1823).jpg](https://commons.wikimedia.org/wiki/File:Francisco_de_Goya,_Saturno_devorando_a_su_hijo_(1819-1823).jpg) | Public domain |
| `fat-44.jpg` | Self-Portrait with Physalis | [Egon Schiele - Self-Portrait with Physalis - Google Art Project.jpg](https://commons.wikimedia.org/wiki/File:Egon_Schiele_-_Self-Portrait_with_Physalis_-_Google_Art_Project.jpg) | Public domain |
| `fat-45.jpg` | The Gleaners | [Jean-François Millet - Gleaners - Google Art Project 2.jpg](https://commons.wikimedia.org/wiki/File:Jean-Fran%C3%A7ois_Millet_-_Gleaners_-_Google_Art_Project_2.jpg) | Public domain |
| `fat-46.jpg` | Primavera (Spring) | [Botticelli-primavera.jpg](https://commons.wikimedia.org/wiki/File:Botticelli-primavera.jpg) | Public domain |
| `fat-47.jpg` | The Heart of the Andes | [Church Heart of the Andes.jpg](https://commons.wikimedia.org/wiki/File:Church_Heart_of_the_Andes.jpg) | Public domain |
| `fat-48.jpg` | Las Meninas | [Las Meninas, by Diego Velázquez, from Prado in Google Earth.jpg](https://commons.wikimedia.org/wiki/File:Las_Meninas,_by_Diego_Vel%C3%A1zquez,_from_Prado_in_Google_Earth.jpg) | Public domain |
| `fat-49.jpg` | Composition II in Red | [Piet Mondriaan, 1930 - Mondrian Composition II in Red, Blue, and Yellow.jpg](https://commons.wikimedia.org/wiki/File:Piet_Mondriaan,_1930_-_Mondrian_Composition_II_in_Red,_Blue,_and_Yellow.jpg) | Public domain |
| `fat-50.jpg` | Isle of the Dead | [Arnold Böcklin - Die Toteninsel III (Alte Nationalgalerie, Berlin).jpg](https://commons.wikimedia.org/wiki/File:Arnold_B%C3%B6cklin_-_Die_Toteninsel_III_(Alte_Nationalgalerie,_Berlin).jpg) | Public domain |
| `fat-51.jpg` | The Raft of the Medusa | [JEAN LOUIS THÉODORE GÉRICAULT - La Balsa de la Medusa (Museo del Louvre, 1818-19).jpg](https://commons.wikimedia.org/wiki/File:JEAN_LOUIS_TH%C3%89ODORE_G%C3%89RICAULT_-_La_Balsa_de_la_Medusa_(Museo_del_Louvre,_1818-19).jpg) | Public domain |
| `fat-52.jpg` | Madame X (Madame Pierre Gautreau) | [Madame X (Madame Pierre Gautreau), John Singer Sargent, 1884 (unfree frame crop).jpg](https://commons.wikimedia.org/wiki/File:Madame_X_(Madame_Pierre_Gautreau),_John_Singer_Sargent,_1884_(unfree_frame_crop).jpg) | Public domain |
| `fat-53.jpg` | Liberty Leading the People | [Eugène Delacroix - La liberté guidant le peuple.jpg](https://commons.wikimedia.org/wiki/File:Eug%C3%A8ne_Delacroix_-_La_libert%C3%A9_guidant_le_peuple.jpg) | Public domain |
| `fat-54.jpg` | Wanderer above the Sea of Fog | [Caspar David Friedrich - Wanderer above the sea of fog.jpg](https://commons.wikimedia.org/wiki/File:Caspar_David_Friedrich_-_Wanderer_above_the_sea_of_fog.jpg) | Public domain |
| `fat-55.jpg` | The Night Watch (Militia Company of District II under the Command of Captain Frans Banninck Cocq) | [The Nightwatch by Rembrandt - Rijksmuseum.jpg](https://commons.wikimedia.org/wiki/File:The_Nightwatch_by_Rembrandt_-_Rijksmuseum.jpg) | Public domain |
| `fat-56.jpg` | The Kiss (Der Kuss) | [Gustav Klimt 016.jpg](https://commons.wikimedia.org/wiki/File:Gustav_Klimt_016.jpg) | Public domain |
| `fat-57.jpg` | Girl with a Pearl Earring | [Meisje met de parel.jpg](https://commons.wikimedia.org/wiki/File:Meisje_met_de_parel.jpg) | Public domain |
| `fat-58.jpg` | Judith Slaying Holofernes | [Artemisia Gentileschi - Giuditta decapita Oloferne - Google Art Project.jpg](https://commons.wikimedia.org/wiki/File:Artemisia_Gentileschi_-_Giuditta_decapita_Oloferne_-_Google_Art_Project.jpg) | Public domain |
| `fat-59.jpg` | The Starry Night | [Van Gogh - Starry Night - Google Art Project.jpg](https://commons.wikimedia.org/wiki/File:Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg) | Public domain |
| `fat-60.jpg` | Ia Orana Maria (Hail Mary) | [Paul Gauguin - Ia Orana Maria (Hail Mary) - Google Art Project.jpg](https://commons.wikimedia.org/wiki/File:Paul_Gauguin_-_Ia_Orana_Maria_(Hail_Mary)_-_Google_Art_Project.jpg) | Public domain |

## Known gaps

1. **Text painted into three works names or points at the answer** (in round 1 and in dev v5 / test v2):
   - `fat-60.jpg` (Gauguin): "IA ORANA MARIA" is painted across the bottom. That is the title.
   - `fat-28.jpg` (David): the crate reads "À MARAT / DAVID", which names the subject.
   - `fat-17.jpg` (Hokusai): the cartouche at top left gives the series and print title in Japanese.
   Round 2 swaps all three out. The files stay in the buckets for the old versions.
2. **Dev's Title column is the artist and date** ("Leonardo da Vinci, c. 1503"), and Title is
   shown during ASK. It is not the title, but it is a strong hint. Test's Title is a teaser
   ("THE ENIGMATIC SMILE") with the artist in School, which players do not see until after
   the reveal. Left as it is: changing content was out of scope.
3. **No RealAnswer.** Neither tier's rows have a RealAnswer column, so none was added. The
   real title lives only in AnswerDetails ("Real title: …"), which only Workie reads.
4. **Absolute per-tier URLs**, as in the What Is This Thing? precedent: a bare key
   (`sets/famousarttitles/fat-NN.jpg`) is not yet rendered against the media base. A table
   copied to another tier would keep pointing at this tier's site.
5. **Old versions still name the works.** Dev v4 and test v1 keep the Commons URLs, and dev
   v1 keeps `/assets/art/<descriptive-name>.jpg`. Only the live versions are fixed. Restoring
   an old version would bring the leak back.
