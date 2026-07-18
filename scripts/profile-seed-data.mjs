// Curated seed list for WelayDaily player & club profiles.
// Keep this list intentionally small and high-quality rather than
// broad and thin — these are the players/clubs global football
// audiences actually search for, which matters both for genuine
// reader value and for search traffic.
//
// IMPORTANT: API-Football's /players endpoint does NOT support a
// pure name-only search — it requires a team or league parameter
// alongside it. So each player entry includes a `club` hint: the
// script resolves that club to a team ID first (via /teams?search=),
// then pulls the team's full squad+stats and matches the player by
// name within that response. If a player transfers clubs, update
// the `club` field here to match their new team.

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
  { slug: "lionel-messi", searchName: "Lionel Messi", club: "Inter Miami" },
  { slug: "cristiano-ronaldo", searchName: "Cristiano Ronaldo", club: "Al Nassr" },
  { slug: "kylian-mbappe", searchName: "Kylian Mbappe", club: "Real Madrid" },
  { slug: "erling-haaland", searchName: "Erling Haaland", club: "Manchester City" },
  { slug: "kevin-de-bruyne", searchName: "Kevin De Bruyne", club: "Napoli" },
  { slug: "jude-bellingham", searchName: "Jude Bellingham", club: "Real Madrid" },
  { slug: "lamine-yamal", searchName: "Lamine Yamal", club: "Barcelona" },
  { slug: "mohamed-salah", searchName: "Mohamed Salah", club: "Liverpool" },
  { slug: "vinicius-junior", searchName: "Vinicius Junior", club: "Real Madrid" },
  { slug: "pedri", searchName: "Pedri", club: "Barcelona" },
  { slug: "robert-lewandowski", searchName: "Robert Lewandowski", club: "Barcelona" },
  { slug: "harry-kane", searchName: "Harry Kane", club: "Bayern Munich" },
  { slug: "virgil-van-dijk", searchName: "Virgil van Dijk", club: "Liverpool" },
  { slug: "phil-foden", searchName: "Phil Foden", club: "Manchester City" },
  { slug: "jamal-musiala", searchName: "Jamal Musiala", club: "Bayern Munich" },
  { slug: "bruno-fernandes", searchName: "Bruno Fernandes", club: "Manchester United" },
  { slug: "rodri", searchName: "Rodri", club: "Manchester City" },
  { slug: "ousmane-dembele", searchName: "Ousmane Dembele", club: "Paris Saint Germain" },
  { slug: "florian-wirtz", searchName: "Florian Wirtz", club: "Liverpool" },
  { slug: "declan-rice", searchName: "Declan Rice", club: "Arsenal" },
];
