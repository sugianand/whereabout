"use client";

import { useEffect } from "react";

import { registerServiceWorker } from "@/lib/offline/register";

/** Registers the offline service worker on every page (production builds only). */
export default function ServiceWorker() {
  useEffect(registerServiceWorker, []);
  return null;
}
