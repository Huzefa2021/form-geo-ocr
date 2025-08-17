import json
from shapely.geometry import shape, Point

class GeoIndex:
    def __init__(self, wards_path, beats_path, police_path):
        self.wards  = self._load(wards_path)
        self.beats  = self._load(beats_path)
        self.police = self._load(police_path)

    @staticmethod
    def _load(path):
        with open(path, "r", encoding="utf-8") as f:
            gj = json.load(f)
        return [(shape(feat["geometry"]), feat.get("properties", {})) for feat in gj["features"]]

    def lookup(self, lat: float, lon: float):
        pt = Point(float(lon), float(lat))  # shapely expects (x=lon, y=lat)
        out = {"WARD":"", "BEAT_NO":"", "PS_NAME":""}
        for g, p in self.wards:
            if g.contains(pt):
                out["WARD"] = p.get("WARD") or p.get("name", "")
                break
        for g, p in self.beats:
            if g.contains(pt):
                out["BEAT_NO"] = p.get("BEAT_NO") or p.get("name", "")
                break
        for g, p in self.police:
            if g.contains(pt):
                out["PS_NAME"] = p.get("PS_NAME") or p.get("name", "")
                break
        return out
