// The base map under the simulated roads: sea, land use, rivers, piers, railway and buildings baked from
// OpenStreetMap (viewer/basemap/basemap.json, buildings.json; ODbL), hill shading and terrain from bundled
// terrain tiles (viewer/basemap/terrain/), and place labels. Light and quiet so the traffic colours dominate
// (checked in test/basemap.test.mjs). Built by sim/vhsim/viewer/basemap.py and terrain.py; sources in
// viewer/basemap/SOURCES.md. Nothing here loads from the internet, so it works in the published artifact.

export const OSM_CREDIT = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
// short form of the terrain credit in viewer/basemap/terrain/tiles.json (the link has the full text), so the credits
// shown when the map opens don't cover a phone-sized map
export const TERRAIN_CREDIT = 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Terrain Tiles</a>, '
  + '© Commonwealth of Australia (Geoscience Australia) 2017 CC BY 4.0, USGS, NOAA';
export const PITCH_3D = 58;
export const TERRAIN_EXAGGERATION = 1.5;

export const BASEMAP_COLOURS = {
  light: {
    land: '#f4f3ee', sea: '#d9e3e8', water: '#d3dfe6', waterway: '#b9cbd6', shore: '#c5d2d9',
    farmland: '#efeee2', grass: '#e6eadb', park: '#e1e8d6', pitch: '#dde6d2', golf: '#dfe8d5', wood: '#d8e2cf', scrub: '#e1e6d6',
    sand: '#efe9d8', rock: '#e2e0da', residential: '#ecebe6', commercial: '#ebe7e3', cemetery: '#e0e6da', wetland: '#d9e4df', caravan: '#ebe9df',
    building: '#dcd9d2', buildingLine: '#cbc8c0', building3d: '#e3e0d8', pier: '#cfccc4', rail: '#b4b1a9', bridge: '#c9c6be',
    shadow: '#5f5e58', highlight: '#ffffff', accent: '#8d8c85',
  },
  dark: {
    land: '#171716', sea: '#1b2329', water: '#1d262c', waterway: '#2a3943', shore: '#26323a',
    farmland: '#1d1d19', grass: '#1b201a', park: '#1a2119', pitch: '#1b231a', golf: '#1a2219', wood: '#18211a', scrub: '#1c201a',
    sand: '#24221c', rock: '#22221f', residential: '#1d1d1c', commercial: '#201e1d', cemetery: '#1b201a', wetland: '#1a2220', caravan: '#1f1e1b',
    building: '#2a2a28', buildingLine: '#343431', building3d: '#30302d', pier: '#3a3936', rail: '#4b4a46', bridge: '#3d3c39',
    shadow: '#000000', highlight: '#3a3a36', accent: '#000000',
  },
};

const LANDUSE = ['farmland', 'grass', 'park', 'pitch', 'golf', 'wood', 'scrub', 'sand', 'rock', 'residential', 'commercial', 'cemetery', 'wetland', 'caravan'];
export const LABEL_CLASSES = ['water', 'island', 'landmark', 'peak', 'suburb', 'park', 'school', 'hospital'];

const isLayer = (l) => ['==', ['get', 'l'], l];
const zw = (pairs) => ['interpolate', ['exponential', 1.6], ['zoom'], ...pairs];
const river = (wide, narrow) => ['match', ['get', 'c'], 'river', wide, narrow];

/** Height of a building's extrusion (metres) from the baked `h`. */
export const buildingHeight = () => ['max', 1, ['coalesce', ['get', 'h'], 4.5]];

/** MapLibre layers of the base map, bottom to top, for sources 'bm', 'bm-buildings' and 'bm-hillshade'. */
export function basemapLayers(theme) {
  const C = BASEMAP_COLOURS[theme === 'dark' ? 'dark' : 'light'];
  return [
    { id: 'bm-landuse', type: 'fill', source: 'bm', filter: isLayer('landuse'),
      paint: { 'fill-color': ['match', ['get', 'c'], ...LANDUSE.flatMap((c) => [c, C[c]]), C.land], 'fill-antialias': false } },
    { id: 'bm-sea', type: 'fill', source: 'bm', filter: isLayer('sea'), paint: { 'fill-color': C.sea } },
    { id: 'bm-shore', type: 'line', source: 'bm', filter: isLayer('sea'),
      paint: { 'line-color': C.shore, 'line-width': zw([11, 0.5, 16, 1.5]) } },
    { id: 'bm-water', type: 'fill', source: 'bm', filter: isLayer('water'), paint: { 'fill-color': C.water } },
    { id: 'bm-waterway', type: 'line', source: 'bm', filter: isLayer('waterway'), layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': C.waterway, 'line-width': zw([11, river(1, 0.3), 14, river(3, 0.8), 17, river(9, 2.5)]) } },
    { id: 'bm-hillshade', type: 'hillshade', source: 'bm-hillshade',
      paint: { 'hillshade-shadow-color': C.shadow, 'hillshade-highlight-color': C.highlight, 'hillshade-accent-color': C.accent,
        'hillshade-exaggeration': theme === 'dark' ? 0.45 : 0.32, 'hillshade-illumination-direction': 315 } },
    { id: 'bm-pier-area', type: 'fill', source: 'bm', filter: ['all', isLayer('pier'), ['==', ['geometry-type'], 'Polygon']],
      paint: { 'fill-color': C.pier } },
    { id: 'bm-pier', type: 'line', source: 'bm', filter: ['all', isLayer('pier'), ['==', ['geometry-type'], 'LineString']],
      layout: { 'line-cap': 'butt' }, paint: { 'line-color': C.pier, 'line-width': zw([12, 1.5, 15, 4, 18, 16]) } },
    { id: 'bm-bridge', type: 'line', source: 'bm', filter: isLayer('bridge'), layout: { 'line-cap': 'butt' },
      paint: { 'line-color': C.bridge, 'line-width': zw([12, 1.5, 15, 4, 18, 14]) } },
    { id: 'bm-rail', type: 'line', source: 'bm', filter: isLayer('rail'),
      paint: { 'line-color': C.rail, 'line-width': zw([12, 0.6, 16, 1.8]), 'line-dasharray': [3, 2],
        'line-opacity': ['match', ['get', 'c'], 'disused', 0.5, 1] } },
    { id: 'bm-buildings', type: 'fill', source: 'bm-buildings', minzoom: 13,
      paint: { 'fill-color': C.building, 'fill-outline-color': C.buildingLine, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 15, 1] } },
    { id: 'bm-buildings-3d', type: 'fill-extrusion', source: 'bm-buildings', minzoom: 13, layout: { visibility: 'none' },
      paint: { 'fill-extrusion-color': C.building3d, 'fill-extrusion-height': buildingHeight(), 'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.85, 'fill-extrusion-vertical-gradient': true } },
  ];
}

/** Paint updates for a theme switch: [layerId, property, value]. */
export function basemapPaint(theme) {
  return basemapLayers(theme).flatMap((l) => Object.entries(l.paint).map(([k, v]) => [l.id, k, v]));
}

/** Labels to show at a zoom (each label carries the zoom `z` it appears from). */
export const labelsAt = (labels, zoom) => labels.filter((l) => (l.z ?? 0) <= zoom + 1e-9);

/**
 * Which bundled terrain tile to draw tile z/x/y from: itself when bundled, else the nearest bundled ancestor,
 * with k = 2^(z − ancestor z) (the requested tile is a 1/k slice of it) and (dx, dy) = its position in that
 * ancestor in slices. null when no ancestor is bundled (outside the terrain).
 */
export function demSourceTile(z, x, y, have, minzoom = 0) {
  for (let az = z; az >= minzoom; az--) {
    const k = 2 ** (z - az), ax = Math.floor(x / k), ay = Math.floor(y / k);
    if (have.has(`${az}/${ax}/${ay}`)) return { z: az, x: ax, y: ay, k, dx: x - ax * k, dy: y - ay * k };
  }
  return null;
}
