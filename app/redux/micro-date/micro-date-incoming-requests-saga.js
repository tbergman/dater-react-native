import { call, take, put, takeLatest, select, cancel, fork, spawn } from 'redux-saga/effects';
import { eventChannel, buffers } from 'redux-saga';
import firebase from 'react-native-firebase';

import { NavigatorActions } from '../../navigators/navigator-actions';
import GeoUtils from '../../utils/geo-utils';
import {
  MICRO_DATES_COLLECTION,
  GEO_POINTS_COLLECTION,
  GEO_POINTS_PAST_MICRO_DATES_COLLECTION,
} from '../../constants';
import { MicroDate } from '../../types';

export default function* microDateIncomingRequestsSaga() {
  try {
    const myUid = yield select((state) => state.auth.uid);
    const incomingMicroDateRequestsChannel = yield call(createChannelForIncomingMicroDateRequests, myUid);
    const pendingFinalScreen = yield getPendingViewFinishedMicroDate(myUid);

    if (pendingFinalScreen) {
      const pendingTask = yield fork(incomingMicroDateFinishedSaga);
      yield* incomingMicroDateUpdatedSaga(pendingFinalScreen);
      cancel(pendingTask);
    }
    yield fork(incomingMicroDateAcceptInitSaga);

    while (true) {
      const microDate: MicroDate = yield take(incomingMicroDateRequestsChannel);

      if (microDate.error) {
        throw new Error(JSON.stringify(microDate.error));
      }

      const task1 = yield fork(restoreIncomingMicroDateOnAppLaunchSaga);

      const task2 = yield fork(incomingMicroDateDeclineByMeSaga, microDate);
      const task3 = yield fork(incomingMicroDateStopByMeSaga, microDate);

      const task4 = yield fork(incomingMicroDateSelfieDeclineByMeSaga, microDate);
      const task5 = yield fork(incomingMicroDateSelfieAcceptByMeSaga, microDate);
      const task6 = yield fork(incomingMicroDateFinishedSaga);

      const microDateChannel = yield call(createChannelToMicroDate, microDate.id);
      const microDateUpdatesTask = yield takeLatest(microDateChannel, incomingMicroDateUpdatedSaga);

      yield take([
        'MICRO_DATE_INCOMING_REMOVE',
        'MICRO_DATE_INCOMING_DECLINED_BY_ME',
        'MICRO_DATE_INCOMING_CANCELLED',
        'MICRO_DATE_INCOMING_STOPPED_BY_ME',
        'MICRO_DATE_INCOMING_STOPPED_BY_TARGET',
        'MICRO_DATE_INCOMING_FINISHED',
      ]);

      yield put({ type: 'MICRO_DATE_INCOMING_SAGA_CANCEL_TASKS' });
      yield microDateChannel.close();
      yield cancel(microDateUpdatesTask);
      yield cancel(task1, task2, task3, task4, task5, task6);
    }
  } catch (error) {
    yield put({ type: 'MICRO_DATE_INCOMING_ERROR', payload: error });
  }
}

function* incomingMicroDateUpdatedSaga(microDate) {
  try {
    if (microDate.error) {
      throw new Error(JSON.stringify(microDate.error));
    }

    if (microDate.hasNoData) {
      yield put({ type: 'MICRO_DATE_INCOMING_REMOVE' });
      return;
    }

    switch (microDate.status) {
      case 'REQUEST':
        yield put({ type: 'MICRO_DATE_INCOMING_REQUEST', payload: microDate });
        break;
      case 'ACCEPT':
        yield put({ type: 'MICRO_DATE_INCOMING_ACCEPT', payload: microDate });
        break;
      case 'DECLINE':
        break;
      case 'CANCEL':
        yield put({ type: 'MICRO_DATE_INCOMING_CANCELLED', payload: microDate });
        break;
      case 'STOP':
        if (microDate.stopBy !== microDate.requestFor) {
          yield put({ type: 'MICRO_DATE_INCOMING_STOPPED_BY_TARGET', payload: microDate });
        }
        break;
      case 'SELFIE_UPLOADED':
        if (microDate.selfie.uploadedBy === microDate.requestBy) {
          yield put({ type: 'MICRO_DATE_INCOMING_SELFIE_UPLOADED_BY_TARGET', payload: microDate });
        } else if (microDate.selfie.uploadedBy === microDate.requestFor) {
          yield put({ type: 'MICRO_DATE_INCOMING_SELFIE_UPLOADED_BY_ME', payload: microDate });
        }
        break;
      case 'SELFIE_DECLINED':
        if (microDate.declinedSelfieBy === microDate.requestBy) {
          yield put({ type: 'MICRO_DATE_INCOMING_SELFIE_DECLINED_BY_TARGET', payload: microDate });
        } else if (microDate.declinedSelfieBy === microDate.requestFor) {
          yield put({ type: 'MICRO_DATE_INCOMING_SELFIE_DECLINED_BY_ME', payload: microDate });
        }
        break;
      case 'FINISHED':
        yield put({ type: 'MICRO_DATE_INCOMING_FINISH', payload: microDate });
        break;
      default:
        yield put({
          type: 'MICRO_DATE_INCOMING_UPDATED_SAGA_UNKNOWN_STATUS_ERROR',
          payload: `Unknown microDate status: ${microDate.status}`,
        });
        break;
    }
  } catch (error) {
    yield put({ type: 'MICRO_DATE_UPDATED_SAGA_ERROR', payload: error });
  }
}

function* incomingMicroDateAcceptInitSaga() {
  while (true) {
    yield take('MICRO_DATE_INCOMING_ACCEPT_INIT');
    const myCoords = yield select((state) => state.location.coords);
    const microDateState = yield select((state) => state.microDate);
    const userSnap = yield microDateState.microDate.requestByRef.get();

    yield firebase.firestore()
      .collection(MICRO_DATES_COLLECTION)
      .doc(microDateState.microDate.id)
      .update({
        status: 'ACCEPT',
        startDistance: GeoUtils.distance(userSnap.data().geoPoint, myCoords),
        requestForGeoPoint: new firebase.firestore.GeoPoint(myCoords.latitude, myCoords.longitude),
        requestByGeoPoint: userSnap.data().geoPoint,
        acceptTS: firebase.firestore.FieldValue.serverTimestamp(),
      });
  }
}

function* restoreIncomingMicroDateOnAppLaunchSaga() {
  while (true) {
    const action = yield take([
      'MICRO_DATE_INCOMING_ACCEPT',
      'MICRO_DATE_INCOMING_SELFIE_UPLOADED_BY_ME',
      'MICRO_DATE_INCOMING_SELFIE_UPLOADED_BY_TARGET',
      'MICRO_DATE_INCOMING_SELFIE_DECLINED_BY_TARGET',
      'MICRO_DATE_INCOMING_SELFIE_DECLINED_BY_ME',
    ]);
    const microDate = action.payload;
    const isMicroDateMode = yield select((state) => state.microDate.enabled);
    if (!isMicroDateMode) yield* startMicroDateSaga(microDate);
  }
}

function* startMicroDateSaga(microDate) {
  const myCoords = yield select((state) => state.location.coords);
  const userSnap = yield microDate.requestByRef.get();
  const targetUser = {
    id: userSnap.id,
    shortId: userSnap.id.substring(0, 4),
    ...userSnap.data(),
  };
  yield put({
    type: 'MICRO_DATE_INCOMING_STARTED',
    payload: {
      targetUser,
      myCoords,
      microDate,
      distance: GeoUtils.distance(userSnap.data().geoPoint, myCoords),
      microDateId: microDate.id,
    },
  });
  yield put({ type: 'GEO_LOCATION_FORCE_UPDATE' });
  yield put({ type: 'MAPVIEW_SHOW_MY_LOCATION' });
}

function* incomingMicroDateDeclineByMeSaga(microDate) {
  yield take('MICRO_DATE_INCOMING_DECLINE_BY_ME');
  yield firebase.firestore()
    .collection(MICRO_DATES_COLLECTION)
    .doc(microDate.id)
    .update({
      status: 'DECLINE',
      declineTS: firebase.firestore.FieldValue.serverTimestamp(),
      active: false,
    });
  yield put({ type: 'MICRO_DATE_INCOMING_DECLINED_BY_ME' });
}

function* incomingMicroDateStopByMeSaga(microDate) {
  yield take('MICRO_DATE_STOP');
  yield firebase.firestore()
    .collection(MICRO_DATES_COLLECTION)
    .doc(microDate.id)
    .update({
      status: 'STOP',
      active: false,
      stopBy: microDate.requestFor,
      stopTS: firebase.firestore.FieldValue.serverTimestamp(),
    });
  yield put({ type: 'MICRO_DATE_INCOMING_STOPPED_BY_ME' });
}

function* incomingMicroDateSelfieDeclineByMeSaga(microDate) {
  while (true) {
    yield take('MICRO_DATE_DECLINE_SELFIE_BY_ME');
    yield firebase.firestore()
      .collection(MICRO_DATES_COLLECTION)
      .doc(microDate.id)
      .update({
        status: 'SELFIE_DECLINED',
        selfie: null,
        declinedSelfieBy: microDate.requestFor,
      });
  }
}

function* incomingMicroDateSelfieAcceptByMeSaga(microDate) {
  yield take('MICRO_DATE_APPROVE_SELFIE');
  yield firebase.firestore()
    .collection(MICRO_DATES_COLLECTION)
    .doc(microDate.id)
    .update({
      status: 'FINISHED',
      active: false,
      finishTS: firebase.firestore.FieldValue.serverTimestamp(),
      finishBy: microDate.requestFor,
      moderationStatus: 'PENDING',
      [`${microDate.requestBy}_firstAlert`]: false,
      [`${microDate.requestFor}_firstAlert`]: false,
    });
  yield put({ type: 'MICRO_DATE_INCOMING_APPROVED_SELFIE' });
}

function* incomingMicroDateFinishedSaga() {
  const action = yield take('MICRO_DATE_INCOMING_FINISH');
  const microDate = action.payload;
  yield spawn(writeFinishedStateFor, microDate);

  yield NavigatorActions.navigate({
    key: 'MicroDateScreen',
    routeName: 'MicroDateScreen',
    params: { microDate },
  });
  yield put({ type: 'MICRO_DATE_INCOMING_FINISHED' });
}

function* writeFinishedStateFor(microDate: MicroDate) {
  yield firebase.firestore()
    .collection(MICRO_DATES_COLLECTION)
    .doc(microDate.id)
    .update({
      [`${microDate.requestFor}_firstAlert`]: true,
    });
  yield firebase.firestore()
    .collection(GEO_POINTS_COLLECTION)
    .doc(microDate.requestFor)
    .collection(GEO_POINTS_PAST_MICRO_DATES_COLLECTION)
    .doc(microDate.requestBy)
    .set({
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    });
}

function createChannelForIncomingMicroDateRequests(uid) {
  const microDateStartedByOthersQuery = firebase.firestore()
    .collection(MICRO_DATES_COLLECTION)
    .where('requestFor', '==', uid)
    .where('active', '==', true)
    .orderBy('requestTS')
    .limit(1);

  return eventChannel((emit) => {
    const onSnapshotUpdated = (snapshot) => {
      if (snapshot.docs.length > 0 && snapshot.docChanges[0].type === 'added') {
        const microDate = snapshot.docs[0].data();
        emit({
          ...microDate,
          id: snapshot.docs[0].id,
        });
      }
    };

    const onError = (error) => {
      emit({
        error,
      });
    };

    const unsubscribe = microDateStartedByOthersQuery.onSnapshot(onSnapshotUpdated, onError);

    return unsubscribe;
  }, buffers.expanding(5));
}

function createChannelToMicroDate(microDateId) {
  const microDateQuery = firebase.firestore()
    .collection(MICRO_DATES_COLLECTION)
    .doc(microDateId);

  return eventChannel((emit) => {
    const onSnapshotUpdated = (dataSnapshot) => {
      emit({
        ...dataSnapshot.data(),
        hasNoData: typeof dataSnapshot.data() === 'undefined',
        id: dataSnapshot.id,
      });
    };

    const onError = (error) => {
      emit({
        error,
      });
    };

    const unsubscribe = microDateQuery.onSnapshot(onSnapshotUpdated, onError);

    return unsubscribe;
  }, buffers.sliding(1));
}

async function getPendingViewFinishedMicroDate(uid) {
  const microDatesQuery = firebase.firestore()
    .collection(MICRO_DATES_COLLECTION)
    .where('requestFor', '==', uid)
    .where('status', '==', 'FINISHED')
    .where(`${uid}_firstAlert`, '==', false)
    .where('active', '==', false);

  const microDatesSnapshot = await microDatesQuery.get();
  const microDateSnapshot = microDatesSnapshot.docs[0];
  // console.log(uid);
  // const microDate = firebase.firestore()
  //   .collection(MICRO_DATES_COLLECTION)
  //   .doc('lkYF2Aq6lKN9JVzXS155');
  // const microDateSnapshot = await microDate.get();
  return microDateSnapshot ? microDateSnapshot.data() : null;
}
