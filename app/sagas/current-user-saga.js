import { put, takeEvery, select, take, cancel, takeLatest } from 'redux-saga/effects';
import firebase from 'react-native-firebase';
import { eventChannel } from 'redux-saga';

import { CURRENT_USER_COLLECTION } from '../constants';

export default function* currentUserSaga() {
  // yield takeEvery('AUTH_SUCCESS', currentUserSignIn);
  // yield takeEvery('AUTH_SIGNOUT', currentUserSignOut);
  yield takeEvery('CURRENT_USER_SET_PROFILE_FIELDS', currentUserSetProfileFieldSaga);

  while (true) {
    const authSuccessAction = yield take('AUTH_SUCCESS');
    const { uid } = authSuccessAction.payload;
    yield* currentUserSignIn(authSuccessAction); // need this to immediately initialize currentUser
    const currentUserChannel = yield createChannelToCurrentUserInFirestore(uid);
    const currentUserUpdatedTask = yield takeLatest(currentUserChannel, currentUserUpdatedInFirebaseSaga);

    yield take('AUTH_SIGNOUT');
    yield* currentUserSignOut();
    currentUserChannel.close();
    cancel(currentUserUpdatedTask);
  }
}

function* currentUserSignIn(action) {
  const { uid } = action.payload;

  const currentUserSnapshot = yield firebase.firestore()
    .collection(CURRENT_USER_COLLECTION)
    .doc(uid)
    .get();
  const currentUser = currentUserSnapshot.data();

  yield put({
    type: 'CURRENT_USER_SIGN_IN',
    payload: {
      uid,
      gender: currentUser.gender,
      name: currentUser.name,
      birthday: currentUser.birthday,
      mainPhoto: currentUser.mainPhoto,
    },
  });
}

function* currentUserSignOut() {
  yield put({ type: 'CURRENT_USER_SIGN_OUT' });
}

function* currentUserUpdatedInFirebaseSaga(currentUser) {
  yield put({ type: 'CURRENT_USER_UPDATED_IN_FIRESTORE', payload: currentUser });
}

function* currentUserSetProfileFieldSaga(action) {
  const fields = action.payload;
  const myUid = yield select((state) => state.currentUser.uid);

  yield firebase.firestore()
    .collection(CURRENT_USER_COLLECTION)
    .doc(myUid)
    .update({
      ...fields,
    });
}

function createChannelToCurrentUserInFirestore(uid) {
  const query = firebase.firestore()
    .collection(CURRENT_USER_COLLECTION)
    .doc(uid);

  return eventChannel((emit) => {
    const onSnapshotUpdated = (dataSnapshot) => {
      emit({
        ...dataSnapshot.data(),
        uid: dataSnapshot.id,
      });
    };

    const onError = (error) => {
      emit({
        error,
      });
    };

    const unsubscribe = query.onSnapshot(onSnapshotUpdated, onError);

    return unsubscribe;
  });
}
