import { fromJS } from 'immutable';
import Logger from 'js-logger';
import { LOCATION_CHANGE } from 'react-router-redux';
import { delay } from 'redux-saga';
import { cancel, cancelled, fork, put, call, take, select, takeLatest } from 'redux-saga/effects';
import request from 'utils/request';
import { getAuthTokenOrNull, storeAuthToken } from '../../utils/localStorageHelper';
import {
  SEND_EXEC_REQUEST,
  SEND_GET_REQUEST_LIST,
  CANCEL_EXEC_REQUEST,
  LOAD_AUTH_TOKEN,
  setAuthToken,
  sendExecRequestSuccess,
  sendExecRequestError,
  sendGetRequestList,
  sendGetRequestListSuccess,
  sendGetRequestListError,
  requestCreateSuccess,
} from './actions';
import { makeSelectRequest, selectAuthToken } from './selectors';

function* sendCreateRequest() {
  const req = yield select(makeSelectRequest());
  const data = req.get('data');

  const requestURL = '/api/v1/requests';

  const options = {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: `${data.get('method')} ${data.get('url')}`,
    }),
  };

  return yield call(request, requestURL, options);
}

export function* sendExecRequest() {
  let req = yield select(makeSelectRequest());
  if (!req.get('id')) {
    try {
      const created = yield call(sendCreateRequest);
      req = req.set('id', created.id);
      yield put(requestCreateSuccess(fromJS(req)));
      yield put(sendGetRequestList());
    } catch (err) {
      yield put(sendExecRequestError(err));
      return;
    }
  }
  const requestURL = `/api/v1/requests/${req.get('id')}`;
  const method = 'PUT';
  const options = {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(req.get('data')),
  };

  try {
    yield call(request, requestURL, options);
    yield call(tryLoadResponseUntilDone);
  } catch (err) {
    yield put(sendExecRequestError(err));
  }
}

export function* tryLoadResponseUntilDone() {
  const loadTask = yield fork(loadRequestUntilDone);
  yield take(CANCEL_EXEC_REQUEST);
  yield cancel(loadTask);
}

function* loadRequestUntilDone() {
  const req = yield select(makeSelectRequest());

  try {
    for (let i = 0; i < 10; i += 1) {
      const requestURL = `/api/v1/requests/${req.get('id')}`;
      const method = 'GET';
      const options = {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      };

      let loadedReq = null;

      try {
        loadedReq = yield call(request, requestURL, options);
      } catch (err) {
        yield put(sendExecRequestError(err));
        break;
      }

      if (loadedReq.status.status === 'in_progress') {
        yield call(delay, 1000);
      } else if (loadedReq.status.status === 'error') {
        yield put(sendExecRequestError('error from server'));
        return;
      } else {
        yield put(sendExecRequestSuccess(fromJS(loadedReq)));
        return;
      }
    }
    yield put(sendExecRequestError('Waiting response timeout'));
  } finally {
    if (yield cancelled()) {
      yield put(sendExecRequestError('Task cancelled'));
    }
  }
}

export function* sendRequestList() {
  const authToken = yield select(selectAuthToken());
  const requestURL = '/api/v1/requests';
  const method = 'GET';
  const options = {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
  };

  try {
    const json = yield call(request, requestURL, options);
    yield put(sendGetRequestListSuccess(fromJS(json)));
  } catch (err) {
    yield put(sendGetRequestListError(err));
  }
}

export function* loadAuthToken() {
  const authToken = getAuthTokenOrNull();
  if (authToken) {
    yield put(setAuthToken(authToken));
    return;
  }

  const requestURL = '/api/v1/authTokens';
  const method = 'POST';
  const options = {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  };

  try {
    const json = yield call(request, requestURL, options);
    storeAuthToken(json.auth_token);
    yield put(setAuthToken(json.auth_token));
  } catch (err) {
    Logger.error('Requesting authTokens', err);
  }
}

export function* sendExecRequestData() {
  const watcher = yield takeLatest(SEND_EXEC_REQUEST, sendExecRequest);
  yield take(LOCATION_CHANGE);
  yield cancel(watcher);
}

export function* sendExecRequestListData() {
  const watcher = yield takeLatest(SEND_GET_REQUEST_LIST, sendRequestList);
  yield take(LOCATION_CHANGE);
  yield cancel(watcher);
}

export function* loadAuthTokenData() {
  const watcher = yield takeLatest(LOAD_AUTH_TOKEN, loadAuthToken);
  yield take(LOCATION_CHANGE);
  yield cancel(watcher);
}

// All sagas to be loaded
export default [
  sendExecRequestData,
  sendExecRequestListData,
  loadAuthTokenData,
];
