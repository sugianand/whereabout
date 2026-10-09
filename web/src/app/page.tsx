import PinPicker from "@/components/PinPicker";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-4">
        <h1 className="font-sign text-6xl font-extrabold leading-none tracking-tight sm:text-8xl">
          Whereabout
        </h1>
        <p className="max-w-xl text-lg text-chalk-dim">
          Look at a photo, guess where in the world it was taken, and see if you can beat Atlas,
          an AI that reads the clues.
        </p>
      </header>
      <PinPicker />
    </main>
  );
}
