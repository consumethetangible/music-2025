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

        const genreClass = genreMap[genre];
        if (!genreClass) {
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

        // Find all shelves for this genre
        const shelfRegex = new RegExp(`<div class="albums" data-genre="${genreClass}">[\\s\\S]*?(?=\\s*</div>\\s*</div>)`, 'g');
        const shelves = [...html.matchAll(shelfRegex)];

        if (shelves.length === 0) {
            return res.status(400).json({ error: `Could not find genre section: ${genre}` });
        }

        // Get the last shelf
        const lastShelf = shelves[shelves.length - 1];
        const lastShelfContent = lastShelf[0];

        // Count albums in the last shelf
        const albumCount = (lastShelfContent.match(/class="album-cover"/g) || []).length;

        let insertPosition;

        if (albumCount >= 4) {
            // Create a new shelf
            const newShelf = `            <div class="shelf">
                <div class="albums" data-genre="${genreClass}">
${albumEntry}
                </div>
            </div>`;

            // Find the end of the last shelf and insert new shelf after it
            const lastShelfEnd = lastShelf.index + lastShelfContent.length + '</div>\n            </div>'.length;
            html = html.slice(0, lastShelfEnd) + '\n' + newShelf + html.slice(lastShelfEnd);
        } else {
            // Add to existing last shelf
            insertPosition = lastShelf.index + lastShelfContent.length;
            html = html.slice(0, insertPosition) + '\n' + albumEntry + html.slice(insertPosition);
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
