import type { EditState, Region } from '@photo-copilot/domain';

interface RasterBounds { x: number; y: number; width: number; height: number; }

interface MaskOutlineProps {
  state: EditState;
  region: Region;
  regionIndex: number;
  rasterBounds?: RasterBounds;
  box?: { left: number; top: number; width: number; height: number };
}

type Point = { x: number; y: number };

/** 将原图坐标投影到当前裁切、旋转后的画布坐标。此计算与 WebGL 渲染器保持一致。 */
function project(point: Point, state: EditState): Point {
  const crop = state.transform.crop;
  const aspect = (state.sourceWidth * crop.width) / (state.sourceHeight * crop.height);
  const angle = state.transform.angleDeg * Math.PI / 180;
  const cosine = Math.abs(Math.cos(angle));
  const sine = Math.abs(Math.sin(angle));
  const autoScale = Math.min(aspect / (cosine * aspect + sine), 1 / (sine * aspect + cosine));
  const sourceX = ((point.x - crop.x - crop.width * .5) / crop.width) * aspect;
  const sourceY = (point.y - crop.y - crop.height * .5) / crop.height;
  const displayX = Math.cos(angle) * sourceX - Math.sin(angle) * sourceY;
  const displayY = Math.sin(angle) * sourceX + Math.cos(angle) * sourceY;
  return { x: .5 + displayX / (autoScale * aspect), y: .5 + displayY / autoScale };
}

function pathFrom(points: Point[], state: EditState, close = true) {
  return points.map((point, index) => {
    const projected = project(point, state);
    return `${index === 0 ? 'M' : 'L'} ${projected.x} ${projected.y}`;
  }).join(' ') + (close ? ' Z' : '');
}

function ellipsePoints(region: Extract<Region, { shape: 'ellipse' }>) {
  return Array.from({ length: 49 }, (_, index) => {
    const angle = index / 48 * Math.PI * 2;
    return { x: region.centerX + Math.cos(angle) * region.radiusX, y: region.centerY + Math.sin(angle) * region.radiusY };
  });
}

function brushPoints(region: Extract<Region, { shape: 'brush' }>) {
  return region.brushDabs.flatMap((dab) => Array.from({ length: 25 }, (_, index) => {
    const angle = index / 24 * Math.PI * 2;
    return { x: dab.x + Math.cos(angle) * region.brushRadius, y: dab.y + Math.sin(angle) * region.brushRadius };
  }));
}

function rasterPoints(bounds: RasterBounds) {
  return [
    { x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height },
  ];
}

/** 在照片画布上标出当前蒙版的实际作用范围，不依赖任何调色参数。 */
export function MaskOutline({ state, region, regionIndex, rasterBounds, box }: MaskOutlineProps) {
  if (!box || box.width <= 0 || box.height <= 0) return null;
  let paths: string[] = [];
  let labelPoint: Point;

  if (region.shape === 'ellipse') {
    paths = [pathFrom(ellipsePoints(region), state)];
    labelPoint = project({ x: region.centerX, y: region.centerY }, state);
  } else if (region.shape === 'linear') {
    const direction = { x: Math.cos(region.angleDeg * Math.PI / 180), y: Math.sin(region.angleDeg * Math.PI / 180) };
    const normal = { x: -direction.y, y: direction.x };
    const lineAt = (offset: number) => pathFrom([
      { x: region.centerX + direction.x * offset - normal.x * 2, y: region.centerY + direction.y * offset - normal.y * 2 },
      { x: region.centerX + direction.x * offset + normal.x * 2, y: region.centerY + direction.y * offset + normal.y * 2 },
    ], state, false);
    paths = [lineAt(-region.feather), lineAt(0), lineAt(region.feather)];
    labelPoint = project({ x: region.centerX, y: region.centerY }, state);
  } else if (region.shape === 'brush') {
    paths = region.brushDabs.length ? [pathFrom(brushPoints(region), state, false)] : [];
    labelPoint = project(region.brushDabs[0] ?? { x: .5, y: .5 }, state);
  } else {
    if (!rasterBounds || rasterBounds.width <= 0 || rasterBounds.height <= 0) return null;
    paths = [pathFrom(rasterPoints(rasterBounds), state)];
    labelPoint = project({ x: rasterBounds.x, y: rasterBounds.y }, state);
  }

  const label = `M${regionIndex + 1} · ${region.label}`;
  return <svg className="mask-outline" aria-label={`当前蒙版范围：${label}`} style={{ left: box.left, top: box.top, width: box.width, height: box.height }} viewBox="0 0 1 1" preserveAspectRatio="none">
    {paths.map((path, index) => <path key={`shadow-${index}`} className="mask-outline-shadow" d={path} />)}
    {paths.map((path, index) => <path key={`line-${index}`} className={region.shape === 'linear' && index !== 1 ? 'mask-outline-guide' : 'mask-outline-line'} d={path} />)}
    <g transform={`translate(${Math.min(.82, Math.max(.01, labelPoint.x))} ${Math.min(.96, Math.max(.04, labelPoint.y))})`}>
      <rect className="mask-outline-label-bg" x="0" y="-.032" width=".17" height=".04" rx=".008" />
      <text className="mask-outline-label" x=".008" y="-.006" fontSize=".022" fontWeight="700">{label}</text>
    </g>
  </svg>;
}
