import { describe, expect, it } from 'vitest';
import rules from '../../../../cloudbase/database-rules.json';

describe('CloudBase database security rules', () => {
  it('validates a first write from request.data instead of a nonexistent old document', () => {
    expect(rules.create).toContain('auth != null');
    expect(rules.create).toContain('request.data.ownerUid');
    expect(rules.create).toContain("request.data.ledgerKey == 'primary'");
    expect(rules.create).toContain('request.data.revision == 1');
    expect(rules.create).not.toContain('doc.');
  });

  it('keeps creator ownership in every existing-document operation', () => {
    for (const operation of [rules.read, rules.update, rules.delete]) {
      expect(operation).toContain('doc._openid');
      expect(operation).toContain('auth.openid');
      expect(operation).toContain('auth.uid');
    }
  });

  it('does not allow ownerUid to change during updates', () => {
    expect(rules.update).toContain('request.data.ownerUid == undefined');
    expect(rules.update).toContain('request.data.ownerUid == doc.ownerUid');
  });
});
