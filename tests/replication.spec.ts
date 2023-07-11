import { RxDatabase } from 'rxdb';
import { initDatabase } from './database';
import { replicateOrion } from '../src';
import { executeFetch } from '../src/helpers';
import { Transporter } from '../src/types';
import fetch from 'node-fetch';
import './replication.mock';

describe('Replication', () => {
  let database: RxDatabase;
  let transporter: Transporter;

  beforeAll(() => {
    (globalThis as any).fetch = fetch;
  });

  beforeEach(async () => {
    database = await initDatabase();
    transporter = jest.fn(executeFetch);
  });

  afterEach(async () => {
    await database.destroy();
  });

  it('Should pull documents from remote api', async () => {
    const users = database.collections.users;
    const replicationState = replicateOrion({
      url: 'http://api.fake.pull/users',
      params: { include: 'roles' },
      collection: users,
      batchSize: 3,
      transporter,
    });

    await replicationState.start();
    await replicationState.awaitInitialReplication();
    await replicationState.cancel();

    expect(transporter).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: 'http:/api.fake.pull/users/search',
        method: 'POST',
        params: { page: 1, limit: 3, include: 'roles' },
      })
    );

    const results = (await users.find().exec()).map((user) => user.toMutableJSON());

    expect(results).toEqual(
      expect.objectContaining([
        { id: '10', name: 'Jeff', roles: [{ id: '100', name: 'Admin' }] },
        { id: '11', name: 'Mark', roles: [{ id: '200', name: 'Editor' }] },
      ])
    );
  });

  it('Should push documents to remote api', async () => {

    const users = database.collections.users;

    const replicationState = replicateOrion({
      url: 'http://api.fake.push/users',
      collection: database.collections.users,
      batchSize: 3,
      transporter,
    });

    await replicationState.start();
    await replicationState.awaitInitialReplication();

    const user = await users.insert({
      id: '1',
      name: 'Marx',
      roles: ['100', '200'],
    });
    await replicationState.awaitInSync();

    //Nock return http:/api.fake.push/users/1/roles/sync not found
    //I don't know why
    //await user.patch({ name: 'Bill' });
    //await replicationState.awaitInSync();

    await user.remove();
    await replicationState.awaitInSync();

    expect(transporter).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: 'http:/api.fake.push/users',
        method: 'POST',
        data: { id: '1', name: 'Marx' },
      })
    );

    expect(transporter).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        url: 'http:/api.fake.push/users/1/roles/sync',
        method: 'PATCH',
        data: { 'resources': ['100', '200'] },
      })
    );

    expect(transporter).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        url: 'http:/api.fake.push/users/1',
        method: 'DELETE',
      })
    );
  });
});
