import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";

/**
 * Downloads a URL straight to destPath, following multiple redirects.
 * Validates that the content is valid (not HTML error pages).
 */
function download(url, destPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject(new Error(`Too many redirects when downloading ${url}`));
    }

    const client = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(destPath);
    let contentType = "";

    const request = client.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          "Accept": "*/*",
          "Referer": "https://pixabay.com/",
        },
      },
      (res) => {
        contentType = res.headers["content-type"] || "";

        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(destPath);
          return download(res.headers.location, destPath, redirectCount + 1)
            .then(resolve)
            .catch(reject);
        }

        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          return reject(
            new Error(`Failed to download ${url} — HTTP ${res.statusCode}`)
          );
        }

        // Check if we got HTML instead of the actual file
        if (contentType.includes("text/html")) {
          file.close();
          fs.unlinkSync(destPath);
          return reject(
            new Error(
              `Downloaded content is HTML, not a valid file. URL may require direct download link. Got: ${url}`
            )
          );
        }

        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(destPath)));
      }
    );

    request.on("error", (err) => {
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

/**
 * Resolves ANY source (http(s) URL or local file path) to a local file
 * at destPath. Used for both property images and the background music
 * track, since both are "a link or a path that should end up on disk".
 */
export async function fetchToLocal(source, destPath) {
  if (/^https?:\/\//i.test(source)) {
    await download(source, destPath);
  } else {
    const localSrc = path.resolve(source);
    if (!fs.existsSync(localSrc)) {
      throw new Error(`File not found: ${localSrc}`);
    }
    fs.copyFileSync(localSrc, destPath);
  }
  return destPath;
}

/**
 * Resolves an ordered list of image sources to local files, numbered
 * 000, 001, ... so ordering survives on disk regardless of source
 * filenames.
 */
export async function resolveImages(sources, tmpDir) {
  if (!sources || sources.length === 0) {
    throw new Error('No images provided. Check IMAGES in .env or the property\'s "images" array.');
  }
  fs.mkdirSync(tmpDir, { recursive: true });

  const resolved = [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i].trim();
    const ext = path.extname(new URL(src, "file://").pathname) || ".jpg";
    const destPath = path.join(tmpDir, `${String(i).padStart(3, "0")}${ext}`);
    await fetchToLocal(src, destPath);
    resolved.push(destPath);
  }
  return resolved;
}

/**
 * Resolves the (optional, shared) background music track once. Returns
 * null if no source was given so callers can fall back to a silent (-an)
 * render.
 */
export async function resolveMusic(source, tmpDir) {
  if (!source || !source.trim()) return null;
  fs.mkdirSync(tmpDir, { recursive: true });
  const ext = path.extname(new URL(source.trim(), "file://").pathname) || ".mp3";
  const destPath = path.join(tmpDir, `music${ext}`);
  await fetchToLocal(source.trim(), destPath);
  return destPath;
}
