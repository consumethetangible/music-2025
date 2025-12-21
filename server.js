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

// API endpoint to add album to index.html
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

        // Read index.html
        const indexPath = path.join(__dirname, 'index.html');
        let html = await fs.readFile(indexPath, 'utf-8');

        // Create the album entry
        const albumEntry = `        <a class="release clickable" href="${bandcampUrl}" target="_blank" rel="noopener noreferrer">
            <div class="tonearm"></div>
            <picture>
                <source type="image/webp" srcset="${webpFilename}">
                <img loading="lazy" class="artwork" src="${jpgFilename}" alt="${artist} - ${album}">
            </picture>
            <div class="artist">${artist}</div>
            <div class="album">${album}</div>
        </a>`;

        // Find the correct genre section using data-genre attribute
        const genreMatch = html.match(new RegExp(`<div class="releases" data-genre="${genreClass}">[\\s\\S]*?(?=\\s*<\\/div>\\s*<!--)`));
        
        if (!genreMatch) {
            return res.status(400).json({ error: `Could not find genre section: ${genre}` });
        }

        // Insert the new album at the end of the releases div, before the closing tag
        const insertPosition = genreMatch.index + genreMatch[0].length;
        html = html.slice(0, insertPosition) + '\n' + albumEntry + '\n' + html.slice(insertPosition);

        // Write the updated HTML back
        await fs.writeFile(indexPath, html, 'utf-8');

        res.json({ 
            success: true, 
            message: `Added ${artist} - ${album} to ${genre} section` 
        });

    } catch (error) {
        console.error('Add album error:', error);
        res.status(500).json({ error: 'Failed to add album to index.html' });
    }
});

app.listen(PORT, () => {
    console.log(`Admin server running at http://localhost:${PORT}`);
    console.log(`Visit http://localhost:${PORT}/admin to add albums`);
});
