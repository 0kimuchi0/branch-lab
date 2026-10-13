import { useEffect, useRef } from 'react'
import type { GraphLayout } from '../graph/layout'

const LANE_COLOR_COUNT = 6

function laneColor(lane: number): string {
  return `var(--lane-${lane % LANE_COLOR_COUNT})`
}

/** 幅の目安 (px) に収まるように切り詰める。全角文字は半角のおよそ 2 倍の幅として数える。 */
function truncate(text: string, maxWidth: number): string {
  let width = 0
  let result = ''
  for (const char of text) {
    width += char.charCodeAt(0) > 255 ? 11 : 6.2
    if (width > maxWidth) return `${result}…`
    result += char
  }
  return text
}

interface GraphViewProps {
  readonly layout: GraphLayout
  /** スクリーンリーダー向けのグラフの名前。 */
  readonly label: string
}

export function GraphView({ layout, label }: GraphViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // コミットが増えたとき、最新側 (右端) が見えるようにスクロールする
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [layout.width])

  return (
    <div className="graph-scroll" ref={scrollRef}>
      <svg
        className="graph"
        role="img"
        aria-label={label}
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
      >
        {layout.edges.map((edge) => {
          const mid = (edge.x1 + edge.x2) / 2
          return (
            <path
              key={edge.key}
              className={edge.reachable ? 'edge' : 'edge unreachable'}
              d={`M${edge.x1} ${edge.y1} C${mid} ${edge.y1}, ${mid} ${edge.y2}, ${edge.x2} ${edge.y2}`}
              stroke={laneColor(edge.lane)}
            />
          )
        })}

        {layout.nodes.map((node) => (
          <g
            key={node.id}
            className={node.reachable ? 'node-group' : 'node-group unreachable'}
            style={{ transform: `translate(${node.x}px, ${node.y}px)` }}
          >
            <g className="node-enter">
              <title>
                {node.reachable
                  ? `${node.id}: ${node.message}`
                  : `${node.id}: ${node.message} (どのブランチからもたどれません)`}
              </title>
              <circle
                className={node.isMerge ? 'node merge' : 'node'}
                r={node.isMerge ? 17 : 15}
                fill={laneColor(node.lane)}
              />
              <text className="node-id" textAnchor="middle" dy="0.35em">
                {node.id}
              </text>
              <text className="node-message" textAnchor="middle" y={34}>
                {truncate(node.message, 84)}
              </text>
            </g>
          </g>
        ))}

        {layout.labels.map((label) => (
          <g
            key={label.key}
            className={`label label-${label.kind}`}
            style={{ transform: `translate(${label.x}px, ${label.y}px)` }}
          >
            <rect
              x={-label.width / 2}
              y={-11}
              width={label.width}
              height={22}
              rx={11}
            />
            <text textAnchor="middle" dy="0.35em">
              {label.text}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
