import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CONTROLS } from "@/lib/controls";

import ControlsHelp from "./ControlsHelp";

describe("ControlsHelp", () => {
  it("opens from its button and lists every control of the screen with its keys and gestures", () => {
    render(<ControlsHelp screen="round" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Controls" }));

    const sheet = screen.getByRole("dialog", { name: "Controls for a round" });
    for (const group of CONTROLS.round) {
      const section = within(sheet).getByRole("group", { name: group.title });
      for (const control of group.controls) {
        const row = within(section).getByText(control.does).closest("li")!;
        expect(row).toHaveAttribute("data-control", control.id);
        expect(within(row).getByText(control.touch, { selector: ".wb-help-touch" })).toBeTruthy();
        expect(within(row).getByText(control.mouse, { selector: ".wb-help-mouse" })).toBeTruthy();
        expect(Array.from(row.querySelectorAll("kbd"), (k) => k.textContent)).toEqual(
          control.keys.map((k) => k.label),
        );
      }
    }
    expect(within(sheet).getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("opens on ? from anywhere and closes on Esc, giving focus back", () => {
    render(
      <>
        <button type="button">Elsewhere</button>
        <ControlsHelp screen="further-north" />
      </>,
    );
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    elsewhere.focus();
    fireEvent.keyDown(elsewhere, { key: "?", shiftKey: true });
    const sheet = screen.getByRole("dialog", { name: "Controls for Further North" });
    fireEvent.keyDown(within(sheet).getByRole("button", { name: "Close" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(elsewhere).toHaveFocus();
  });

  it("doesn't open while the player types in a field", () => {
    render(
      <>
        <input aria-label="Name" />
        <ControlsHelp screen="round" />
      </>,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "?" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps its key presses from the screen's shortcuts behind it", () => {
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    render(<ControlsHelp screen="odd-one-out" />);
    fireEvent.click(screen.getByRole("button", { name: "Controls" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Close" }), { key: "1" });
    expect(behind).not.toHaveBeenCalled();
    window.removeEventListener("keydown", behind);
  });

  it("closes from its button and from a tap outside the sheet", () => {
    render(<ControlsHelp screen="round" />);
    fireEvent.click(screen.getByRole("button", { name: "Controls" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Controls" }));
    fireEvent.pointerDown(screen.getByRole("dialog").parentElement!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
