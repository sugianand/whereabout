import Game from "@/components/Game";
import { bundledDeck } from "@/lib/game/bundled";

// Set NEXT_PUBLIC_API_URL to play against the FastAPI backend; without it the game runs
// entirely in the browser from the bundled catalog (docs/decisions/0002-static-demo-mode.md).
const API_URL = process.env.NEXT_PUBLIC_API_URL || undefined;

// The page ships only the deck (photo ids); each game fetches its five records
// (src/lib/game/deck.ts), so the catalog can grow without growing the page.
export default function Home() {
  return <Game apiUrl={API_URL} deck={bundledDeck} />;
}
