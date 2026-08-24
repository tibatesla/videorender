import fs from "node:fs";
import path from "node:path";

/**
 * ffmpeg's drawtext filter can read its text from a file (textfile=...)
 * instead of an inline string. That sidesteps the very fiddly escaping
 * rules for ':' , ''' , '\' and '%' inside the filter graph — important
 * here since prices/locations are free-form data (e.g. "St. Mary's Rd",
 * commas, parentheses) that shouldn't need per-property hand-escaping.
 */
export function writeTextFiles(tmpDir, { brand, location, bedrooms, meta, price, contact, city, description }) {
  fs.mkdirSync(tmpDir, { recursive: true });

  const files = {
    brand: path.join(tmpDir, "brand.txt"),
    location: path.join(tmpDir, "location.txt"),
    bedrooms: path.join(tmpDir, "bedrooms.txt"),
    meta: path.join(tmpDir, "meta.txt"),
    price: path.join(tmpDir, "price.txt"),
    contact: path.join(tmpDir, "contact.txt"),
    city: path.join(tmpDir, "city.txt"),
    description: path.join(tmpDir, "description.txt"),
  };

  fs.writeFileSync(files.brand, brand, "utf8");
  fs.writeFileSync(files.location, location, "utf8");
  fs.writeFileSync(files.bedrooms, bedrooms, "utf8");
  fs.writeFileSync(files.meta, meta, "utf8");
  fs.writeFileSync(files.price, price, "utf8");
  fs.writeFileSync(files.contact, contact, "utf8");
  fs.writeFileSync(files.city, city, "utf8");
  fs.writeFileSync(files.description, wrapDescription(description || ""), "utf8");

  return files;
}

function wrapDescription(value) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > 42) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}