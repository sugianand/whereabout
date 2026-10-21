import { describe, expect, it } from "vitest";

import { bundledById, bundledDeck } from "@/lib/game/bundled";

import { GET, generateStaticParams } from "./route";

const get = (version: string, file: string) =>
  GET(new Request("http://localhost/"), { params: Promise.resolve({ version, file }) });

describe("game-data route", () => {
  it("writes one file per playable photo under the deck's version", () => {
    const params = generateStaticParams();
    expect(params).toHaveLength(bundledDeck.ids.length);
    expect(params[0]).toEqual({ version: bundledDeck.version, file: `${bundledDeck.ids[0]}.json` });
  });

  it("serves a photo's record", async () => {
    const id = bundledDeck.ids[0];
    const res = await get(bundledDeck.version, `${id}.json`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(JSON.parse(JSON.stringify(bundledById.get(id))));
  });

  it("has nothing for another version or an unknown photo", async () => {
    expect((await get("00000000", `${bundledDeck.ids[0]}.json`)).status).toBe(404);
    expect((await get(bundledDeck.version, "nope.json")).status).toBe(404);
    expect((await get(bundledDeck.version, bundledDeck.ids[0])).status).toBe(404);
  });
});
