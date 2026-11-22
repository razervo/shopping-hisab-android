export const BILL_MAX_BYTES = 10 * 1024 * 1024;

const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;

// Phone cameras often report an empty or HEIC type, so accept anything that is
// clearly an image or a PDF instead of a fixed list of MIME types.
export function isAcceptedBill(file) {
  if (!file || Number(file.size) <= 0) return false;
  const type = String(file.type || "").toLowerCase();
  const name = String(file.name || "");
  const byName = IMAGE_EXT.test(name) || /\.pdf$/i.test(name);
  const supportedImageType = /^image\/(jpeg|png|webp|heic|heif)$/i.test(type);
  // Some Android camera/gallery providers label JPEG/HEIC files as
  // application/octet-stream. Trust only supported image/PDF extensions in that case.
  return type === "application/pdf" || supportedImageType || byName;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

// Bills are read by a vision model. Large camera photos and HEIC/HEIF files are
// converted to JPEG in the browser first. If HEIC/HEIF cannot be decoded on the
// device, fail with a clear message rather than uploading bytes the reader rejects.
export async function prepareBillFile(file) {
  if (!file) throw new Error("No bill file selected");
  const type = String(file.type || "").toLowerCase();
  const name = String(file.name || "");
  const isPdf = type === "application/pdf" || /\.pdf$/i.test(name);
  if (isPdf) return file;

  const alreadySmall = ["image/jpeg", "image/png"].includes(type) && file.size <= 3 * 1024 * 1024;
  if (alreadySmall) return file;

  try {
    const img = await loadImage(file);
    const maxSide = 2000;
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) return file;

    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!blob) return file;

    const name = (file.name || "bill").replace(/\.[^.]+$/, "") || "bill";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  } catch {
    if (/heic|heif/i.test(type) || /\.heic|\.heif/i.test(name)) {
      throw new Error("This HEIC photo could not be converted on this device. Please choose a JPG or PNG photo instead.");
    }
    if (["image/jpeg", "image/png", "image/webp"].includes(type)) return file;
    throw new Error("This image format could not be prepared. Please choose a JPG, PNG or WEBP photo.");
  }
}