// Songs that are popular somewhere else.
//
// Not a quality judgement and not the same thing as obscure. Every song listed
// here scores well - the median canonicity of the Brazilian funk alone is 86,
// and 78 of those tracks were tagged `standard`, meaning the sampler believed
// they were songs everyone knows. Casual dealt them about 1.7 times a night.
//
// The cause is that canonicity measures global curation and this table is in
// Stellenbosch. Deezer's Brazilian playlists are enormous, so a Sao Paulo funk
// set from 2023 collects more playlist appearances than most of the eighties,
// and every mechanism downstream reads that as fame. Nothing was broken: the
// measure answered the question it was asked, which turned out to be the wrong
// question.
//
// Excluded by ARTIST rather than by song, because these artists release
// constantly and the generator will keep finding them. A song list would need
// re-editing after every import; an artist list holds.
//
// This is deliberately a hand-checked list and not a rule. The same query that
// finds Mc IG also finds DJ Jazzy Jeff & The Fresh Prince, DJ Quik, MC Hammer,
// DJ Snake and DJ Khaled, and the pattern cannot tell them apart. A person can.
export const EXCLUDED_ARTISTS = new Set([
  "dj andreoli",
  "DJ Boy",
  "DJ GBR",
  "DJ GM",
  "DJ Gu",
  "DJ Guuga",
  "DJ Japa NK",
  "DJ Matt D",
  "DJ Oreia",
  "Dj Topo",
  "DJ Victor",
  "DJ WN",
  "dj yuri pedrada",
  "DJ Zullu",
  "Ludmilla",
  "Mc Bruninho da Praia",
  "MC Cebezinho",
  "Mc Cr\u00e9u",
  "Mc Davi",
  "Mc Don Juan",
  "MC Du Black",
  "MC Fioti",
  "MC G15",
  "Mc GP",
  "MC Gustta",
  "Mc Gw",
  "Mc Hariel",
  "Mc IG",
  "Mc Iguinho Ct",
  "MC Ingryd",
  "Mc J9",
  "Mc Joao",
  "Mc Joaozinho VT",
  "MC JottaP\u00ea",
  "MC Jvila",
  "MC Kadu",
  "MC Kekel",
  "Mc Kelvinho",
  "MC Kevin o Chris",
  "Mc Kevinho",
  "MC L da Vinte",
  "Mc Lan",
  "Mc Lele JP",
  "Mc Lipi",
  "MC Livinho",
  "MC Loma e As G\u00eameas Lacra\u00e7\u00e3o",
  "MC LUUKY",
  "MC Marcinho",
  "MC Marks",
  "Mc Menor da Vg",
  "MC MM",
  "Mc Neg\u00e3o Original",
  "Mc Neguinho do ITR",
  "Mc Paiva ZS",
  "MC Paulin da Capital",
  "Mc Pikachu",
  "Mc PP da VS",
  "MC Rahell",
  "Mc Rodolfinho",
  "MC Ryan SP",
  "MC WM",
].map((a) => a.toLowerCase()));

// One-offs: the artist is not otherwise excluded, but this track is the same
// case. Mostly Brazilian, plus two French rap records that reached the pool the
// same way - Deezer is a French company and its index leans accordingly.
export const EXCLUDED_SONGS = new Set([
  "the box|the box medley funk 2",
  "the box|the box medley funk 6",
  "oruam|m\u00f3 temp\u00e3o que tu n\u00e3o fala comigo",
  "perlla|tremendo vacil\u00e3o",
  "bonde do tigr\u00e3o|o baile todo",
  "chimarruts|do lado de c\u00e1",
  "onze:20|n\u00e3o vai voltar",
  "onze:20|pra voc\u00ea",
  "gabriel o pensador|solit\u00e1rio surfista / surfista solit\u00e1rio",
  "latino|festa no ap\u00ea (dragostea din tei)",
  "luka|t\u00f4 nem a\u00ed",
  "furac\u00e3o 2000|dan\u00e7a da motinha",
  "chiclete com banana|100% voc\u00ea",
  "felipe dylon|musa do ver\u00e3o",
  "tribalistas|j\u00e1 sei namorar",
  "pk|quando a vontade bater (participa\u00e7\u00e3o especial de mc cabelinho)",
  "jean-jacques goldman|au bout de mes r\u00eaves",
  "iam|l'empire du c\u00f4t\u00e9 obscur",

  // Named at the table, after a first pass left them in as arguable. Each is
  // globally enormous and none of it lands here: a Spanish World Cup single from
  // 1998, two Latin tracks, and a Dutch producer's Brazilian sample.
  //
  // Song-level on purpose. Ricky Martin, Bad Bunny and The Weeknd all hold songs
  // this table does know - Livin' la Vida Loca, Blinding Lights, Starboy - so the
  // artist is not the thing that is wrong.
  "ricky martin|la copa de la vida (la canci\u00f3n oficial de la copa mundial, francia '98) (spanish version)",
  "bad bunny|tit\u00ed me pregunt\u00f3",
  "the weeknd|s\u00e3o paulo",
  "bakermat|baian\u00e1",
].map((s) => s.toLowerCase()));

/** True if this song should never reach the deck. */
export function isExcluded(song) {
  if (EXCLUDED_ARTISTS.has(String(song.artist).toLowerCase())) return true;
  return EXCLUDED_SONGS.has(`${song.artist}|${song.title}`.toLowerCase());
}
