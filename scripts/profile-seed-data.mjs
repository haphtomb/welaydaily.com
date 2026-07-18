// Curated seed list for WelayDaily player & club profiles.
// Keep this list intentionally small and high-quality rather than
// broad and thin — these are the players/clubs global football
// audiences actually search for, which matters both for genuine
// reader value and for search traffic.
//
// IMPORTANT: we deliberately look these up BY NAME at fetch time
// (via API-Football's /players?search= and /teams?search= endpoints)
// rather than hardcoding numeric IDs. API-Football's internal IDs
// aren't something we can reliably guess or verify offline, and a
// wrong hardcoded ID would silently fetch the wrong person/club.
// Name search is slightly less efficient (uses a bit more quota)
// but is far more robust and self-correcting.

export const CURATED_CLUBS = [
  { slug: "manchester-united", searchName: "Manchester United" },
  { slug: "liverpool", searchName: "Liverpool" },
  { slug: "manchester-city", searchName: "Manchester City" },
  { slug: "arsenal", searchName: "Arsenal" },
  { slug: "chelsea", searchName: "Chelsea" },
  { slug: "real-madrid", searchName: "Real Madrid" },
  { slug: "barcelona", searchName: "Barcelona" },
  { slug: "bayern-munich", searchName: "Bayern Munich" },
  { slug: "paris-saint-germain", searchName: "Paris Saint Germain" },
  { slug: "inter-milan", searchName: "Inter" },
];

export const CURATED_PLAYERS = [
  { slug: "lionel-messi", searchName: "Lionel Messi" },
  { slug: "cristiano-ronaldo", searchName: "Cristiano Ronaldo" },
  { slug: "kylian-mbappe", searchName: "Kylian Mbappe" },
  { slug: "erling-haaland", searchName: "Erling Haaland" },
  { slug: "kevin-de-bruyne", searchName: "Kevin De Bruyne" },
  { slug: "jude-bellingham", searchName: "Jude Bellingham" },
  { slug: "lamine-yamal", searchName: "Lamine Yamal" },
  { slug: "mohamed-salah", searchName: "Mohamed Salah" },
  { slug: "vinicius-junior", searchName: "Vinicius Junior" },
  { slug: "pedri", searchName: "Pedri" },
  { slug: "robert-lewandowski", searchName: "Robert Lewandowski" },
  { slug: "harry-kane", searchName: "Harry Kane" },
  { slug: "virgil-van-dijk", searchName: "Virgil van Dijk" },
  { slug: "phil-foden", searchName: "Phil Foden" },
  { slug: "jamal-musiala", searchName: "Jamal Musiala" },
  { slug: "bruno-fernandes", searchName: "Bruno Fernandes" },
  { slug: "rodri", searchName: "Rodri" },
  { slug: "ousmane-dembele", searchName: "Ousmane Dembele" },
  { slug: "florian-wirtz", searchName: "Florian Wirtz" },
  { slug: "declan-rice", searchName: "Declan Rice" },
];
