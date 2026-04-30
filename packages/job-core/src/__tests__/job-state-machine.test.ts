import { describe, expect, it } from 'vitest';

import { JobConflictError, JobStateMachine } from '../state-machine.js';
import { JobStatus } from '../status.js';

const validTransitions = new Set(
  [
    [JobStatus.PENDING, JobStatus.RUNNING],
    [JobStatus.PENDING, JobStatus.CANCELLED],
    [JobStatus.RUNNING, JobStatus.SUCCEEDED],
    [JobStatus.RUNNING, JobStatus.FAILED],
    [JobStatus.RUNNING, JobStatus.CANCELLED],
    [JobStatus.FAILED, JobStatus.PENDING],
  ].map(([from, to]) => `${from}->${to}`),
);

describe('JobStateMachine', () => {
  it('accepts every valid transition', () => {
    for (const key of validTransitions) {
      const [from, to] = key.split('->') as [JobStatus, JobStatus];
      expect(() => JobStateMachine.validate(from, to)).not.toThrow();
    }
  });

  it('rejects every invalid transition with a 409 conflict error', () => {
    for (const from of Object.values(JobStatus)) {
      for (const to of Object.values(JobStatus)) {
        const key = `${from}->${to}`;
        if (validTransitions.has(key)) {
          continue;
        }

        try {
          JobStateMachine.validate(from, to);
          throw new Error(`Expected ${key} to be rejected`);
        } catch (error) {
          expect(error).toBeInstanceOf(JobConflictError);
          expect((error as JobConflictError).statusCode).toBe(409);
        }
      }
    }
  });

  it('covers every status pair in the transition matrix', () => {
    const totalPairs = Object.values(JobStatus).length ** 2;
    const testedPairs = new Set<string>();

    for (const from of Object.values(JobStatus)) {
      for (const to of Object.values(JobStatus)) {
        testedPairs.add(`${from}->${to}`);
      }
    }

    expect(testedPairs.size).toBe(totalPairs);
    expect(validTransitions.size).toBe(6);
  });
});
