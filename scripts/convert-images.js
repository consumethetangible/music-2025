const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const glob = require('glob');

const root = process.cwd();
// patterns to find source raster images (skip already .webp/.avif)
const patterns = ['**/*.{jpg,jpeg,png}'];

async function convert(file) {
  const abs = path.resolve(root, file);
  const dir = path.dirname(abs);
  const ext = path.extname(abs);
  const base = path.basename(abs, ext);

  const webpOut = path.join(dir, base + '.webp');
  const avifOut = path.join(dir, base + '.avif');

  try {
    const img = sharp(abs, { animated: false });
    // produce webp
    if (!fs.existsSync(webpOut)) {
      await img.toFile(webpOut, {
        // when using toFile with format object, we need to chain toFormat
      }).catch(async () => {
        // fallback: re-read and toFormat
        await sharp(abs).webp({ quality: 80 }).toFile(webpOut);
      });
      console.log('wrote', path.relative(root, webpOut));
    } else {
      console.log('skipping existing', path.relative(root, webpOut));
    }

    // produce avif
    if (!fs.existsSync(avifOut)) {
      await sharp(abs).avif({ quality: 50 }).toFile(avifOut);
      console.log('wrote', path.relative(root, avifOut));
    } else {
      console.log('skipping existing', path.relative(root, avifOut));
    }
  } catch (err) {
    console.error('error converting', file, err.message);
  }
}

(async () => {
  try {
    const files = glob.sync(patterns.join('\n'), { nodir: true, dot: false });
    // glob with join above isn't great; use a direct glob call for common patterns
    const all = glob.sync('**/*.{jpg,jpeg,png}', { nodir: true, ignore: ['node_modules/**', '.git/**'] });
    if (!all.length) {
      console.log('No source images found to convert.');
      return;
    }

    for (const f of all) {
      await convert(f);
    }
    console.log('done');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
