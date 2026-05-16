export interface SegmentInput {
  totalItems: number;
  segmentSize: number;
}

export interface Segment {
  index: number;
  start: number;
  endExclusive: number;
}

export function buildSegments(input: SegmentInput): Segment[] {
  if (!Number.isInteger(input.totalItems) || input.totalItems < 0) {
    throw new Error("totalItems must be a non-negative integer");
  }
  if (!Number.isInteger(input.segmentSize) || input.segmentSize <= 0) {
    throw new Error("segmentSize must be a positive integer");
  }

  const segments: Segment[] = [];
  for (let start = 0, index = 0; start < input.totalItems; start += input.segmentSize, index += 1) {
    segments.push({
      index,
      start,
      endExclusive: Math.min(start + input.segmentSize, input.totalItems)
    });
  }
  return segments;
}
