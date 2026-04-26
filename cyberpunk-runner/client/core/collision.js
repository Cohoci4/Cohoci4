export class CollisionSystem {
  checkAABB(a, b) {
    return (
      a.minX < b.maxX &&
      a.maxX > b.minX &&
      a.minY < b.maxY &&
      a.maxY > b.minY &&
      a.minZ < b.maxZ &&
      a.maxZ > b.minZ
    );
  }

  checkSphere(posA, radiusA, posB, radiusB) {
    const dx = posA.x - posB.x;
    const dy = posA.y - posB.y;
    const dz = posA.z - posB.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    const radSum = radiusA + radiusB;
    return distSq < radSum * radSum;
  }
}
