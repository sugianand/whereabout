import { bundledById, bundledDeck } from "@/lib/game/bundled";

// One static JSON file per playable photo: the photo and Atlas's guess for it. The static export
// writes them to out/game-data/<version>/<id>.json and the game fetches the five it deals
// (src/lib/game/deck.ts), so the home page's JavaScript stays the same size as the catalog grows.
export const dynamic = "force-static";
export const dynamicParams = false;

type Params = { version: string; file: string };

export function generateStaticParams(): Params[] {
  return bundledDeck.ids.map((id) => ({ version: bundledDeck.version, file: `${id}.json` }));
}

export async function GET(_request: Request, { params }: { params: Promise<Params> }) {
  const { version, file } = await params;
  const id = file.endsWith(".json") ? file.slice(0, -".json".length) : null;
  const record = version === bundledDeck.version && id ? bundledById.get(id) : undefined;
  if (!record) return Response.json({ error: "No such photo record" }, { status: 404 });
  return Response.json(record);
}
