import { useEffect, useMemo, useRef } from 'react'
import type { Repo } from '../git/model'
import { computeLayout } from '../graph/layout'

const LANE_COLOR_COUNT = 6

function laneColor(lane: number): string {
  return `var(--lane-${lane % LANE_COLOR_COUNT})`
}

function truncate(text: string, max: number): string {
  const chars = [...text]
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`
}

interface GraphViewProps {
  readonly repo: Repo
}

export function GraphView({ repo }: GraphViewProps) {
  const layout = useMemo(() => computeLayout(repo), [repo])
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
        aria-label="コミットグラフ"
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
      >
        {layout.edges.map((edge) => {
          const mid = (edge.x1 + edge.x2) / 2
          return (
            <path
              key={edge.key}
              className="edge"
              d={`M${edge.x1} ${edge.y1} C${mid} ${edge.y1}, ${mid} ${edge.y2}, ${edge.x2} ${edge.y2}`}
              stroke={laneColor(edge.lane)}
            />
          )
        })}

        {layout.nodes.map((node) => (
          <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
            <g className="node-enter">
              <title>{`${node.id}: ${node.message}`}</title>
              <circle
                className={node.isMerge ? 'node merge' : 'node'}
                r={node.isMerge ? 17 : 15}
                fill={laneColor(node.lane)}
              />
              <text className="node-id" textAnchor="middle" dy="0.35em">
                {node.id}
              </text>
              <text className="node-message" textAnchor="middle" y={34}>
                {truncate(node.message, 14)}
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
