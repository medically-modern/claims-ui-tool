/**
 * AddressAutocomplete — Google Places address type-ahead, ported verbatim in
 * behaviour from the Command Center's component (Josh, 2026-09-21) so the two
 * apps fill addresses the same way.
 *
 * It fills ONE formatted address string ("123 Main St Apt 4, Utica, NY 13501"),
 * not split street/city/state/zip fields — matching how the Subscription Board
 * stores an address (a single location column). The zip is always included and
 * a +4 is trimmed; apartment/unit (subpremise) is preserved.
 *
 * Loading: the Google Maps JS API is pulled in via a <script> tag on first use
 * (there is no npm package — nothing to add to package.json), keyed by
 * VITE_GOOGLE_MAPS_API_KEY. That key ships in the browser bundle, so it MUST be
 * HTTP-referrer-restricted to the app's domain in the Google Cloud console.
 * With no key the field degrades to a plain text input.
 */
import { useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

let mapsLoaded = false;
let mapsLoading = false;
const loadCallbacks: (() => void)[] = [];

/** Strip "-NNNN" off any 5-digit zip. We only store 5-digit zips. */
export function stripZipPlus4(addr: string): string {
  return addr.replace(/(\b\d{5})-\d{4}\b/g, "$1");
}

async function loadGooglePlaces(): Promise<void> {
  if (mapsLoaded) return;
  if (mapsLoading) {
    return new Promise((resolve) => { loadCallbacks.push(resolve); });
  }
  mapsLoading = true;

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!key) {
    console.warn("VITE_GOOGLE_MAPS_API_KEY is not set — address autocomplete disabled");
    mapsLoading = false;
    return;
  }

  return new Promise<void>((resolve, reject) => {
    if ((window as any).google?.maps?.places) {
      mapsLoaded = true;
      mapsLoading = false;
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
    script.async = true;
    script.onload = () => {
      mapsLoaded = true;
      mapsLoading = false;
      loadCallbacks.forEach((cb) => cb());
      loadCallbacks.length = 0;
      resolve();
    };
    script.onerror = () => {
      mapsLoading = false;
      reject(new Error("Google Maps script failed to load"));
    };
    document.head.appendChild(script);
  });
}

/**
 * Build a full address from place.address_components, guaranteeing the zip
 * is always included and apartment/unit numbers are preserved.
 */
function buildFullAddress(place: any): string {
  const components = place.address_components;
  if (!components || components.length === 0) {
    return place.formatted_address || "";
  }

  const get = (type: string, short = false): string => {
    const c = components.find((comp: any) => comp.types.includes(type));
    if (!c) return "";
    return short ? c.short_name : c.long_name;
  };

  const streetNumber = get("street_number");
  const route = get("route");
  const subpremise = get("subpremise");
  const city =
    get("locality") ||
    get("sublocality_level_1") ||
    get("administrative_area_level_3");
  const state = get("administrative_area_level_1", true);
  const zip = get("postal_code");

  let street = [streetNumber, route].filter(Boolean).join(" ");
  if (subpremise) street += ` ${subpremise}`;
  const stateZip = [state, zip].filter(Boolean).join(" ");
  const parts = [street, city, stateZip].filter(Boolean);
  return parts.join(", ");
}

export interface AddressResult {
  address: string;
  lat: number;
  lng: number;
}

interface Props {
  value: string;
  onChange: (result: AddressResult) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

export function AddressAutocomplete({ value, onChange, placeholder, className, disabled, ...rest }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  const [ready, setReady] = useState(mapsLoaded);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // Load Google Places
  useEffect(() => {
    loadGooglePlaces()
      .then(() => setReady(true))
      .catch(() => {/* fallback already showing */});
  }, []);

  // Create the Autocomplete widget once ready
  useEffect(() => {
    if (!ready || !inputRef.current || autocompleteRef.current) return;
    if (!(window as any).google?.maps?.places?.Autocomplete) return;

    const ac = new (window as any).google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: "us" },
      types: ["address"],
      fields: ["address_components", "formatted_address", "geometry"],
    });

    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      if (!place || !place.address_components) return;

      let addr = buildFullAddress(place);
      addr = stripZipPlus4(addr);

      const lat = place.geometry?.location?.lat() ?? 0;
      const lng = place.geometry?.location?.lng() ?? 0;

      // Update the input to show the full address with zip
      if (inputRef.current) inputRef.current.value = addr;

      onChangeRef.current({ address: addr, lat, lng });
    });

    autocompleteRef.current = ac;

    return () => {
      if (autocompleteRef.current) {
        (window as any).google.maps.event.clearInstanceListeners(autocompleteRef.current);
        autocompleteRef.current = null;
      }
    };
  }, [ready]);

  // Sync external value changes (patient switch)
  useEffect(() => {
    if (inputRef.current && inputRef.current.value !== (value ?? "")) {
      inputRef.current.value = value ?? "";
    }
  }, [value]);

  return (
    <input
      ref={inputRef}
      className={className}
      defaultValue={value}
      disabled={disabled}
      onChange={(e) => {
        // Manual typing (no suggestion picked) — propagate raw text
        onChangeRef.current({ address: e.target.value, lat: 0, lng: 0 });
      }}
      placeholder={placeholder ?? "Start typing address…"}
      {...rest}
    />
  );
}
