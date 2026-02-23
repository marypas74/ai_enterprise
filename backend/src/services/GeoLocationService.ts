/**
 * GeoLocationService - IP geolocation lookup for login tracking
 * Uses ip-api.com (free tier, 45 req/min) with in-memory cache
 */

interface GeoInfo {
  ip: string;
  country: string;
  countryCode: string;
  region: string;
  city: string;
  lat: number;
  lon: number;
  isp: string;
  timestamp: number;
}

const geoCache = new Map<string, GeoInfo>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function isPrivateIP(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost'
    || ip.startsWith('10.') || ip.startsWith('172.') || ip.startsWith('192.168.');
}

export async function getGeoLocation(ip: string): Promise<GeoInfo> {
  if (isPrivateIP(ip)) {
    return {
      ip,
      country: 'Local Network',
      countryCode: 'LO',
      region: '-',
      city: '-',
      lat: 0,
      lon: 0,
      isp: 'Private',
      timestamp: Date.now(),
    };
  }

  const cached = geoCache.get(ip);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached;
  }

  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,lat,lon,isp`);
    const data = await res.json() as Record<string, any>;

    if (data.status === 'success') {
      const info: GeoInfo = {
        ip,
        country: data.country || 'Unknown',
        countryCode: data.countryCode || '??',
        region: data.regionName || '-',
        city: data.city || '-',
        lat: data.lat || 0,
        lon: data.lon || 0,
        isp: data.isp || '-',
        timestamp: Date.now(),
      };
      geoCache.set(ip, info);
      return info;
    }
  } catch {
    // Geo lookup failed — non-blocking, return minimal info
  }

  return {
    ip,
    country: 'Unknown',
    countryCode: '??',
    region: '-',
    city: '-',
    lat: 0,
    lon: 0,
    isp: '-',
    timestamp: Date.now(),
  };
}
