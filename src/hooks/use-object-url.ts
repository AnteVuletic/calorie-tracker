import { useEffect, useRef, useState } from "react";

/**
 * Create a blob: object URL for a Blob.
 * Pass `stableKey` (e.g. meal id) when the Blob may be a new wrapper for the
 * same bytes on each IndexedDB read — otherwise the effect revokes the old URL
 * on every refetch and the thumbnail can break until remount.
 */
export function useObjectUrl(
  blob: Blob | null | undefined,
  stableKey?: string,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const blobRef = useRef(blob);
  blobRef.current = blob;

  const dep = stableKey ?? blob;

  useEffect(() => {
    const current = blobRef.current;
    if (!current) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(current);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [dep]);

  return url;
}
