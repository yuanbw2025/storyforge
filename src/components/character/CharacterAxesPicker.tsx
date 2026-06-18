import type {
  CharacterMoralAxis,
  CharacterOrderAxis,
  CharacterRoleWeight,
} from '../../lib/types'
import {
  MORAL_AXES,
  MORAL_AXIS_LABELS,
  ORDER_AXES,
  ORDER_AXIS_LABELS,
  ROLE_WEIGHTS,
  ROLE_WEIGHT_LABELS,
} from '../../lib/character/character-axes'

interface Props {
  roleWeight: CharacterRoleWeight | null
  moralAxis: CharacterMoralAxis | null
  orderAxis: CharacterOrderAxis | null
  onChange: (value: {
    roleWeight: CharacterRoleWeight | null
    moralAxis: CharacterMoralAxis | null
    orderAxis: CharacterOrderAxis | null
  }) => void
  compact?: boolean
}

export default function CharacterAxesPicker({
  roleWeight, moralAxis, orderAxis, onChange, compact = false,
}: Props) {
  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div>
        <p className="text-[11px] text-text-muted mb-1">戏份（必选）</p>
        <div className="grid grid-cols-4 gap-1">
          {ROLE_WEIGHTS.map(weight => (
            <button
              key={weight}
              type="button"
              onClick={() => onChange({ roleWeight: weight, moralAxis, orderAxis })}
              className={`px-2 py-1.5 text-xs rounded border transition-colors ${
                roleWeight === weight
                  ? 'bg-accent text-white border-accent'
                  : 'bg-bg-base text-text-secondary border-border hover:border-accent/50'
              }`}
            >
              {ROLE_WEIGHT_LABELS[weight]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[11px] text-text-muted mb-1">阵营九宫格（必选）</p>
        <div className="grid grid-cols-[44px_repeat(3,minmax(0,1fr))] gap-1 items-stretch">
          <span />
          {MORAL_AXES.map(moral => (
            <span key={moral} className="text-[10px] text-center text-text-muted py-0.5">
              {MORAL_AXIS_LABELS[moral]}
            </span>
          ))}
          {ORDER_AXES.map(order => (
            <div key={order} className="contents">
              <span className="text-[10px] text-text-muted flex items-center">
                {ORDER_AXIS_LABELS[order]}
              </span>
              {MORAL_AXES.map(moral => {
                const selected = moralAxis === moral && orderAxis === order
                return (
                  <button
                    key={`${order}-${moral}`}
                    type="button"
                    onClick={() => onChange({ roleWeight, moralAxis: moral, orderAxis: order })}
                    className={`px-1 py-1.5 text-[10px] rounded border transition-colors ${
                      selected
                        ? 'bg-accent/15 text-accent border-accent'
                        : 'bg-bg-base text-text-secondary border-border hover:border-accent/50'
                    }`}
                  >
                    {order === 'neutral' && moral === 'neutral'
                      ? '绝对中立'
                      : `${ORDER_AXIS_LABELS[order]}${MORAL_AXIS_LABELS[moral]}`}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
