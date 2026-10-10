/** Mount the compatible upstream provider with DSCODE interaction defaults. */
import ComputerUseBundle from '@anionex/dsh-computer-use';

export const name = 'dscode-computer-use';
export function apply(ctx, config = {}) {
  ctx.plugin(ComputerUseBundle, config);
}
