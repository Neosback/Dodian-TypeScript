import { Boundary } from './Boundary';
import { Location } from "./Location";

export class PolygonalBoundary extends Boundary {
    private readonly points: Array<[number, number]> = [];

    constructor(points: number[][]) {
        super(0, 0, 0, 0);
        this.points = points.map((p) => [p[0], p[1]]);
    }

    // Basic ray-casting point-in-polygon
    inside(p: Location) {
        let inside = false;
        const x = p.getX();
        const y = p.getY();
        for (let i = 0, j = this.points.length - 1; i < this.points.length; j = i++) {
            const xi = this.points[i][0], yi = this.points[i][1];
            const xj = this.points[j][0], yj = this.points[j][1];
            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }
}
