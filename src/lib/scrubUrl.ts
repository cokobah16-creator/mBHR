/**
 * URL cleaning for error reports (src/main.tsx).
 *
 * A URL can carry secrets and patient details: the query string (a sign-in
 * code, the contact details in a portal invitation link, the filters of a
 * database request), the fragment (Supabase puts password-recovery tokens
 * there) and record ids in the path (/patients/<id>). Reports keep only the
 * shape of the path.
 */

/**
 * A path segment that names a record: a ULID (the app's ids), a UUID
 * (account ids) or a long number, with or without a file extension.
 */
const ID_SEGMENT =
  /^(?:[0-9A-HJKMNP-TV-Z]{26}|[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}|\d{4,})(?:\.[A-Z0-9]{1,8})?$/i;

/** The URL without its query string and fragment, with record ids as ":id". */
export function scrubUrl(url: string): string {
  return url
    .split(/[?#]/)[0]
    .split("/")
    .map((segment) => (ID_SEGMENT.test(segment) ? ":id" : segment))
    .join("/");
}

/** Cleans the named URL fields of a breadcrumb's or span's data in place. */
export function scrubUrlFields(
  data: Record<string, unknown> | undefined,
  keys: readonly string[],
): void {
  if (!data) return;
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string") data[key] = scrubUrl(value);
  }
}
