// Minimal Google Cloud Storage upload using the metadata-server access token
// (available on Cloud Run). No SDK / gRPC — just the JSON API over fetch, which
// works cleanly under Bun.

async function getAccessToken(): Promise<string> {
  const resp = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!resp.ok) throw new Error(`metadata token error ${resp.status}`);
  const json = (await resp.json()) as { access_token: string };
  return json.access_token;
}

// Upload `data` as JSON to gs://<bucket>/<name>, setting content type and a
// cache header in one multipart request.
export async function uploadJson(
  bucket: string,
  name: string,
  data: unknown,
  cacheControl = "public, max-age=300, s-maxage=3600",
): Promise<void> {
  const token = await getAccessToken();
  const boundary = "ll-boundary-" + name.replace(/[^a-z0-9]/gi, "");
  const meta = JSON.stringify({ name, cacheControl, contentType: "application/json" });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n` +
    `--${boundary}--`;

  const url = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=multipart`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!resp.ok) {
    throw new Error(`GCS upload failed ${resp.status}: ${await resp.text()}`);
  }
}
