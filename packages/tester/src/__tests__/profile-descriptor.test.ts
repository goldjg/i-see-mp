import { describe, expect, it } from 'vitest';
import {
  E2E_PROFILE_DESCRIPTORS,
  FILESYSTEM_FETCH_GITHUB_PROFILE,
  FILESYSTEM_FETCH_PROFILE,
  FILESYSTEM_ONLY_PROFILE,
  SAFE_PROFILE_DESCRIPTOR,
  selectProfilesForTopology,
} from '../profile-descriptor.js';

describe('selectProfilesForTopology', () => {
  const filesystemServer = { id: 's-fs', name: 'filesystem' };
  const fetchServer = { id: 's-fetch', name: 'fetch' };
  const githubServer = { id: 's-gh', name: 'github' };

  it('selects filesystem-only topology and skips inapplicable profiles', () => {
    const result = selectProfilesForTopology(
      [filesystemServer],
      [{ serverId: filesystemServer.id, capabilities: ['READ_LOCAL_FILE'] }],
      E2E_PROFILE_DESCRIPTORS,
      { hasCredentials: false },
    );
    expect(result.selected.map((p) => p.profileId)).toContain(FILESYSTEM_ONLY_PROFILE.profileId);
    expect(result.selected.map((p) => p.profileId)).not.toContain(FILESYSTEM_FETCH_PROFILE.profileId);
    expect(result.skipped.some((s) => s.reason === 'not applicable to topology')).toBe(true);
  });

  it('selects filesystem-fetch topology and enforces capability gates', () => {
    const result = selectProfilesForTopology(
      [filesystemServer, fetchServer],
      [
        { serverId: filesystemServer.id, capabilities: ['READ_LOCAL_FILE'] },
        { serverId: fetchServer.id, capabilities: ['SEND_HTTP'] },
      ],
      E2E_PROFILE_DESCRIPTORS,
      { hasCredentials: false },
    );
    expect(result.selected.map((p) => p.profileId)).toContain(FILESYSTEM_FETCH_PROFILE.profileId);
    expect(result.selected.map((p) => p.profileId)).not.toContain(FILESYSTEM_FETCH_GITHUB_PROFILE.profileId);
  });

  it('selects filesystem-fetch-github and skips credential-required profiles when credentials missing', () => {
    const result = selectProfilesForTopology(
      [filesystemServer, fetchServer, githubServer],
      [
        { serverId: filesystemServer.id, capabilities: ['READ_LOCAL_FILE'] },
        { serverId: fetchServer.id, capabilities: ['SEND_HTTP', 'UNTRUSTED_CONTENT_EXPOSURE'] },
        { serverId: githubServer.id, capabilities: ['READ_REMOTE_DATA'] },
      ],
      E2E_PROFILE_DESCRIPTORS,
      { hasCredentials: false },
    );
    expect(result.selected.map((p) => p.profileId)).toContain(FILESYSTEM_FETCH_GITHUB_PROFILE.profileId);
    expect(
      result.skipped.some(
        (s) => s.profileId === 'github-safe-canary' && s.reason === 'missing required credentials',
      ),
    ).toBe(true);
  });

  it('does not select safe profile for github-only topologies', () => {
    const result = selectProfilesForTopology(
      [githubServer],
      [{ serverId: githubServer.id, capabilities: ['READ_REMOTE_DATA', 'MUTATE_REMOTE_STATE'] }],
      [SAFE_PROFILE_DESCRIPTOR],
      { hasCredentials: false },
    );
    expect(result.selected).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe('not applicable to topology');
  });
});
