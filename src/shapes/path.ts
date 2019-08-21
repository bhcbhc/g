import * as Util from '@antv/util';
import Shape from '../core/shape';
import PathSegment from './util/path-segment';
import * as Format from '../util/format';
import * as Arrow from './util/arrow';
import * as PathUtil from '../util/path';
import * as CubicMath from './math/cubic';
import isPointInPathByContext from './util/is-point-in-path-by-ctx';
import BBox from '../core/bbox';
import { PointType } from '../interface';

class Path extends Shape {
  canFill: boolean = true;
  canStroke: boolean = true;
  type: string = 'path';

  getDefaultAttrs() {
    return {
      path: null,
      lineWidth: 1,
      startArrow: false,
      endArrow: false,
    };
  }

  isPointInPath(x: number, y: number): boolean {
    const self = this;
    const segments = self.get('segments');
    const fill = self.hasFill();
    const stroke = self.hasStroke();
    function _isPointInStroke() {
      if (!Util.isEmpty(segments)) {
        const lineWidth = self.getHitLineWidth();
        for (let i = 0, l = segments.length; i < l; i++) {
          if (segments[i].isInside(x, y, lineWidth)) {
            return true;
          }
        }
        return false;
      }
    }

    if (fill && stroke) {
      return isPointInPathByContext(x, y, self) || _isPointInStroke();
    }

    if (fill) {
      return isPointInPathByContext(x, y, self);
    }

    if (stroke) {
      return _isPointInStroke();
    }
    return false;
  }

  _afterSetAttrPath(path: any[]): void {
    const self = this;
    if (Util.isNil(path)) {
      self.setSilent('segments', null);
      self.setSilent('box', undefined);
      return;
    }
    const pathArray = Format.parsePath(path);
    let preSegment;
    const segments = [];

    if (!Util.isArray(pathArray) || pathArray.length === 0 || (pathArray[0][0] !== 'M' && pathArray[0][0] !== 'm')) {
      return;
    }
    const count = pathArray.length;
    for (let i = 0; i < pathArray.length; i++) {
      const item = pathArray[i];
      preSegment = new PathSegment(item, preSegment, i === count - 1);
      segments.push(preSegment);
    }
    self.setSilent('segments', segments);
    self.setSilent('tCache', null);
    self.setSilent('box', null);
  }

  calculateBox(): BBox {
    const self = this;
    const segments = self.get('segments');

    if (!segments) {
      return null;
    }
    const lineWidth = this.getHitLineWidth();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    Util.each(segments, function(segment: PathSegment): void {
      segment.getBBox(lineWidth);
      const box = segment.box as BBox;
      if (box) {
        if (box.x < minX) {
          minX = box.x;
        }

        const boxMaxX = box.maxX;
        if (boxMaxX > maxX) {
          maxX = boxMaxX;
        }

        if (box.y < minY) {
          minY = box.y;
        }

        const boxMaxY = box.maxY;
        if (boxMaxY > maxY) {
          maxY = boxMaxY;
        }
      }
    });
    if (minX === Infinity || minY === Infinity) {
      return new BBox(0, 0, 0, 0);
    }
    return new BBox(minX, minY, maxX - minX, maxY - minY);
  }

  _setTcache() {
    let totalLength = 0;
    let tempLength = 0;
    const tCache = [];
    let segmentT;
    let segmentL;
    let segmentN;
    let l;
    const curve = this.cfg.curve;

    if (!curve) {
      return;
    }

    Util.each(curve, function(segment, i) {
      segmentN = curve[i + 1];
      l = segment.length;
      if (segmentN) {
        totalLength += CubicMath.len(
          segment[l - 2],
          segment[l - 1],
          segmentN[1],
          segmentN[2],
          segmentN[3],
          segmentN[4],
          segmentN[5],
          segmentN[6]
        );
      }
    });

    Util.each(curve, function(segment, i) {
      segmentN = curve[i + 1];
      l = segment.length;
      if (segmentN) {
        segmentT = [];
        segmentT[0] = tempLength / totalLength;
        segmentL = CubicMath.len(
          segment[l - 2],
          segment[l - 1],
          segmentN[1],
          segmentN[2],
          segmentN[3],
          segmentN[4],
          segmentN[5],
          segmentN[6]
        );
        tempLength += segmentL;
        segmentT[1] = tempLength / totalLength;
        tCache.push(segmentT);
      }
    });
    this.cfg.tCache = tCache;
  }

  _calculateCurve() {
    const self = this;
    const attrs = self.attrs;
    const path = attrs.path;
    this.cfg.curve = PathUtil.pathTocurve(path);
  }

  getStartTangent(): PointType[] {
    const segments = this.get('segments');
    let startPoint, endPoint, tangent, result;
    if (segments.length > 1) {
      startPoint = segments[0].endPoint;
      endPoint = segments[1].endPoint;
      tangent = segments[1].startTangent;
      result = [];
      if (Util.isFunction(tangent)) {
        const v = tangent();
        result.push([startPoint.x - v[0], startPoint.y - v[1]]);
        result.push([startPoint.x, startPoint.y]);
      } else {
        result.push([endPoint.x, endPoint.y]);
        result.push([startPoint.x, startPoint.y]);
      }
    }
    return result;
  }

  getEndTangent(): PointType[] {
    const segments = this.get('segments');
    const segmentsLen = segments.length;
    let startPoint, endPoint, tangent, result;
    if (segmentsLen > 1) {
      startPoint = segments[segmentsLen - 2].endPoint;
      endPoint = segments[segmentsLen - 1].endPoint;
      tangent = segments[segmentsLen - 1].endTangent;
      result = [];
      if (Util.isFunction(tangent)) {
        const v = tangent();
        result.push([endPoint.x - v[0], endPoint.y - v[1]]);
        result.push([endPoint.x, endPoint.y]);
      } else {
        result.push([startPoint.x, startPoint.y]);
        result.push([endPoint.x, endPoint.y]);
      }
    }
    return result;
  }

  getPoint(t: number): PointType {
    let tCache = this.cfg.tCache;
    let subt;
    let index;

    if (!tCache) {
      this._calculateCurve();
      this._setTcache();
      tCache = this.cfg.tCache;
    }

    const curve = this.cfg.curve;

    if (!tCache) {
      if (curve) {
        return {
          x: curve[0][1],
          y: curve[0][2],
        };
      }
      return null;
    }
    Util.each(tCache, function(v, i) {
      if (t >= v[0] && t <= v[1]) {
        subt = (t - v[0]) / (v[1] - v[0]);
        index = i;
      }
    });
    const seg = curve[index];
    if (Util.isNil(seg) || Util.isNil(index)) {
      return null;
    }
    const l = seg.length;
    const nextSeg = curve[index + 1];
    return {
      x: CubicMath.at(seg[l - 2], nextSeg[1], nextSeg[3], nextSeg[5], 1 - subt),
      y: CubicMath.at(seg[l - 1], nextSeg[2], nextSeg[4], nextSeg[6], 1 - subt),
    };
  }

  createPath(context: CanvasRenderingContext2D): void {
    const self = this;
    const segments = self.get('segments');
    if (!Util.isArray(segments)) {
      return;
    }
    context = context || self.get('context');

    context.beginPath();
    const segmentsLen = segments.length;

    for (let i = 0; i < segmentsLen; i++) {
      segments[i].draw(context);
    }
  }

  afterPath(context: CanvasRenderingContext2D): void {
    const self = this;
    const attrs = self.attrs;
    const segments = self.get('segments');
    const path = attrs.path;
    context = context || self.get('context');
    if (!Util.isArray(segments)) {
      return;
    }
    if (segments.length === 1) {
      return;
    }
    if (!attrs.startArrow && !attrs.endArrow) {
      return;
    }
    if (path[path.length - 1] === 'z' || path[path.length - 1] === 'Z' || attrs.fill) {
      // 闭合路径不绘制箭头
      return;
    }
    const startPoints = self.getStartTangent();
    Arrow.addStartArrow(context, attrs, startPoints[0][0], startPoints[0][1], startPoints[1][0], startPoints[1][1]);

    const endPoints = self.getEndTangent();
    Arrow.addEndArrow(context, attrs, endPoints[0][0], endPoints[0][1], endPoints[1][0], endPoints[1][1]);
  }
}

export default Path;