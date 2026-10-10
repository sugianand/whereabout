import Game from "@/components/Game";

// Set NEXT_PUBLIC_API_URL to play against the FastAPI backend; without it the game runs
// entirely in the browser from the bundled catalog (docs/decisions/0002-static-demo-mode.md).
const API_URL = process.env.NEXT_PUBLIC_API_URL || undefined;

export default function Home() {
  return <Game apiUrl={API_URL} />;
}
