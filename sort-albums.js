const path = require('path');
const { sortAndRedistributeAlbums } = require('./album-sorter');

const htmlPath = path.join(__dirname, 'index.html');

// Call the shared sorting function with verbose logging
sortAndRedistributeAlbums(htmlPath, true);
