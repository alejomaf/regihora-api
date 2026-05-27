import { PunchAction } from '../domain/enums';

export type AttendanceSessionState = {
  clockedIn: boolean;
  onBreak: boolean;
};

export function getAttendanceSessionState(
  lastAction: PunchAction | undefined,
): AttendanceSessionState {
  switch (lastAction) {
    case PunchAction.CLOCK_IN:
    case PunchAction.BREAK_END:
      return { clockedIn: true, onBreak: false };
    case PunchAction.BREAK_START:
      return { clockedIn: true, onBreak: true };
    case PunchAction.CLOCK_OUT:
    case undefined:
      return { clockedIn: false, onBreak: false };
  }
}

export function isActionAllowedForState(
  action: PunchAction,
  state: AttendanceSessionState,
): boolean {
  switch (action) {
    case PunchAction.CLOCK_IN:
      return !state.clockedIn;
    case PunchAction.BREAK_START:
      return state.clockedIn && !state.onBreak;
    case PunchAction.BREAK_END:
      return state.clockedIn && state.onBreak;
    case PunchAction.CLOCK_OUT:
      return state.clockedIn && !state.onBreak;
  }
}
