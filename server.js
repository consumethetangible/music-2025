const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const sharp = require('sharp');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

// Serve admin interface
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// API endpoint to scrape Bandcamp
app.post('/api/scrape-bandcamp', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url || !url.includes('bandcamp.com')) {
            return res.status(400).json({ error: 'Invalid Bandcamp URL' });
        }

        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        // Extract artist name (multiple fallbacks)
        let artist = $('#name-section h3 span a').text().trim();
        if (!artist) {
            artist = $('meta[property="og:site_name"]').attr('content');
        }
        if (!artist) {
            artist = $('#band-name-location .title').text().trim();
        }

        // Extract album name
        let album = $('#name-section h2.trackTitle').text().trim();
        if (!album) {
            const ogTitle = $('meta[property="og:title"]').attr('content');
            if (ogTitle) {
                album = ogTitle;
            }
        }

        // Extract artwork URL
        let artworkUrl = $('meta[property="og:image"]').attr('content');
        if (!artworkUrl) {
            artworkUrl = $('#tralbumArt img').attr('src');
        }

        if (!artist || !album || !artworkUrl) {
            return res.status(400).json({ 
                error: 'Could not extract album information',
                found: { artist, album, artworkUrl }
            });
        }

        res.json({
            artist: artist.trim(),
            album: album.trim(),
            artworkUrl: artworkUrl,
            bandcampUrl: url
        });

    } catch (error) {
        console.error('Scraping error:', error);
        res.status(500).json({ error: 'Failed to scrape Bandcamp URL' });
    }
});

// API endpoint to download and process artwork
app.post('/api/download-artwork', async (req, res) => {
    try {
        const { artworkUrl, artist, album } = req.body;

        // Create a safe filename
        const safeFilename = `${artist.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${album.toLowerCase().replace(/[^a-z0-9]/g, '-')}`.replace(/-+/g, '-');

        // Download the image
        const imageResponse = await axios.get(artworkUrl, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data);

        // Process and save as JPG
        const jpgPath = path.join(__dirname, `${safeFilename}.jpg`);
        await sharp(imageBuffer)
            .resize(800, 800, { fit: 'cover' })
            .jpeg({ quality: 85 })
            .toFile(jpgPath);

        // Process and save as WebP
        const webpPath = path.join(__dirname, `${safeFilename}.webp`);
        await sharp(imageBuffer)
            .resize(800, 800, { fit: 'cover' })
            .webp({ quality: 85 })
            .toFile(webpPath);

        res.json({
            jpgFilename: `${safeFilename}.jpg`,
            webpFilename: `${safeFilename}.webp`
        });

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Failed to download artwork' });
    }
});

// API endpoint to add album to index-new.html
app.post('/api/add-album', async (req, res) => {
    try {
        const { artist, album, bandcampUrl, genre, jpgFilename, webpFilename } = req.body;

        // Map genre to section class
        const genreMap = {
            'metal': 'metal',
            'stoner-psych': 'stoner-psych',
            'prog': 'prog',
            'rock-pop': 'rock-pop',
            'alternative': 'alternative',
            'archival': 'archival'
        };

        // Map genre to section name (for HTML comments)
        const genreNameMap = {
            'metal': 'Metal',
            'stoner-psych': 'Stoner & Psych',
            'prog': 'Prog',
            'rock-pop': 'Rock & Pop',
            'alternative': 'Alternative',
            'archival': 'Archival / Reissues'
        };

        const genreClass = genreMap[genre];
        const genreName = genreNameMap[genre];
        if (!genreClass || !genreName) {
            return res.status(400).json({ error: 'Invalid genre' });
        }

        // Read index-new.html
        const indexPath = path.join(__dirname, 'index-new.html');
        let html = await fs.readFile(indexPath, 'utf-8');

        // Create the album entry (new shelf format)
        const albumEntry = `                    <a class="album-cover" href="#" data-bandcamp="${bandcampUrl}">
                        <img class="album-artwork" src="${webpFilename}" alt="${artist} - ${album}" loading="lazy">
                        <div class="album-info">
                            <div class="artist">${artist}</div>
                            <div class="album">${album}</div>
                        </div>
                    </a>`;

        // Find the genre section
        const sectionRegex = new RegExp(`<!-- ${genreName} Section -->([\\s\\S]*?)(?=<!-- \\w|<script)`, '');
        const sectionMatch = html.match(sectionRegex);

        if (!sectionMatch) {
            return res.status(400).json({ error: `Could not find genre section: ${genreName}` });
        }

        // Find all shelf containers in this section
        const shelfPattern = /<div class="shelf">[\s\S]*?<div class="albums" data-genre="[^"]+">[\s\S]*?<\/div>\s*<\/div>/g;
        const shelves = [...sectionMatch[0].matchAll(shelfPattern)];

        if (shelves.length === 0) {
            return res.status(400).json({ error: `Could not find shelves in ${genre} section` });
        }

        // Get the last shelf
        const lastShelf = shelves[shelves.length - 1];
        const lastShelfContent = lastShelf[0];

        // Count albums in the last shelf
        const albumCount = (lastShelfContent.match(/class="album-cover"/g) || []).length;

        if (albumCount >= 4) {
            // Create a new shelf after the last shelf
            const newShelf = `
            <div class="shelf">
                <div class="albums" data-genre="${genreClass}">
${albumEntry}
                </div>
            </div>`;

            // Find where the last shelf ends in the full HTML
            const lastShelfGlobalIndex = html.indexOf(lastShelfContent);
            const insertPos = lastShelfGlobalIndex + lastShelfContent.length;
            html = html.slice(0, insertPos) + newShelf + html.slice(insertPos);
        } else {
            // Find the last </a> tag (end of last album) and insert after it
            const lastAlbumEnd = lastShelfContent.lastIndexOf('</a>');

            if (lastAlbumEnd === -1) {
                return res.status(500).json({ error: 'Could not find album structure in shelf' });
            }

            // Insert the new album after the last </a> tag
            const beforeInsert = lastShelfContent.substring(0, lastAlbumEnd + 4); // +4 for </a>
            const afterInsert = lastShelfContent.substring(lastAlbumEnd + 4);
            const updatedShelf = beforeInsert + '\n' + albumEntry + afterInsert;

            // Replace in the full HTML
            html = html.replace(lastShelfContent, updatedShelf);
        }

        // Write the updated HTML back
        await fs.writeFile(indexPath, html, 'utf-8');

        res.json({ 
            success: true, 
            message: `Added ${artist} - ${album} to ${genre} section` 
        });

    } catch (error) {
        console.error('Add album error:', error);
        res.status(500).json({ error: 'Failed to add album to index-new.html' });
    }
});

app.listen(PORT, () => {
    console.log(`Admin server running at http://localhost:${PORT}`);
    console.log(`Visit http://localhost:${PORT}/admin to add albums`);
});
