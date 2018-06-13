import { put, takeEvery, call, take } from 'redux-saga/effects';
import { eventChannel, delay } from 'redux-saga';
import firebase from 'react-native-firebase';
import DeviceInfo from 'react-native-device-info';
import { Platform, Keyboard } from 'react-native';
import { Actions } from '../../navigators/navigator-actions';
import { CURRENT_USER_COLLECTION, GEO_POINTS_COLLECTION } from '../../constants';
import { calculateAgeFrom } from '../../utils/date-utils';

export default function* authSaga() {
  try {
    yield put({ type: 'AUTH_INIT' });
    const authStateChannel = yield call(createAuthStateChannel);
    yield takeEvery(authStateChannel, authStateChangedSaga);
    yield takeEvery('AUTH_SIGNOUT', authSignOutSaga);
  } catch (error) {
    yield put({ type: 'AUTH_MAINSAGA_ERROR', payload: error });
  }
}

function* authSignOutSaga() {
  try {
    yield firebase.auth().signOut();
  } catch (error) {
    yield put({ type: 'AUTH_SIGNOUT_ERROR', payload: error });
  }
}

function* authStateChangedSaga(userInFirebaseAuthState) {
  try {
    if (userInFirebaseAuthState.uid) {
      // initializing firestore write locations
      yield firebase.firestore()
        .collection(GEO_POINTS_COLLECTION)
        .doc(userInFirebaseAuthState.uid)
        .set({
        }, { merge: true });

      yield firebase.firestore()
        .collection(CURRENT_USER_COLLECTION)
        .doc(userInFirebaseAuthState.uid)
        .set({
          phoneNumber: userInFirebaseAuthState.phoneNumber,
        }, { merge: true });

      yield firebase.firestore()
        .collection(CURRENT_USER_COLLECTION)
        .doc(userInFirebaseAuthState.uid)
        .collection('devices')
        .doc(DeviceInfo.getUniqueID())
        .set({
          isEmulator: DeviceInfo.isEmulator(),
          osVersion: DeviceInfo.getSystemVersion(),
          platform: Platform.OS,
          locale: DeviceInfo.getDeviceLocale(),
        }, { merge: true });

      yield put({
        type: 'AUTH_SUCCESS',
        payload: userInFirebaseAuthState,
      });

      const currentUserSignInAction = yield take('CURRENT_USER_SIGN_IN'); // temp
      const currentUserProfile = currentUserSignInAction.payload;

      yield firebase.firestore()
        .collection(GEO_POINTS_COLLECTION)
        .doc(userInFirebaseAuthState.uid)
        .update({
          gender: currentUserProfile.gender,
          name: currentUserProfile.name,
          birthday: currentUserProfile.birthday,
          mainPhoto: currentUserProfile.mainPhoto,
        });

      // TODO: Move to separate analytics saga
      yield firebase.analytics()
        .setUserProperty('gender', currentUserProfile.gender || 'unknown');
      yield firebase.analytics()
        .setUserProperty('age', String(calculateAgeFrom(currentUserProfile.birthday)));
      yield firebase.analytics()
        .setUserId(userInFirebaseAuthState.uid);

      if (!currentUserProfile.gender) {
        yield Actions.navigate({
          key: 'RegisterGender',
          routeName: 'RegisterGender',
          params: {
            navigationFlowType: 'register',
          },
        });
      } else if (!currentUserProfile.name) {
        yield Actions.navigate({
          key: 'RegisterName',
          routeName: 'RegisterName',
        });
      } else if (!currentUserProfile.birthday) {
        yield Actions.navigate({
          key: 'RegisterBirthday',
          routeName: 'RegisterBirthday',
        });
      } else if (!currentUserProfile.mainPhoto) {
        yield Actions.navigate({
          key: 'RegisterMakePhotoSelfie',
          routeName: 'RegisterMakePhotoSelfie',
          params: { photoType: 'profilePhoto' },
        });
      } else {
        yield put({ type: 'GEO_LOCATION_START_AUTO' }); // user is fully registered, start geolocation services
        yield Keyboard.dismiss();
        yield delay(2000); // artificial delay, to allow keyboard hiding
        yield Actions.popToTop();
        yield Actions.back();
      }
    } else {
      yield delay(2000); // artificial delay, otherwise will not show in some cases, TODO: find out why
      yield Actions.navigate({
        key: 'Login',
        routeName: 'Login',
      });
    }
  } catch (error) {
    yield put({ type: 'AUTH_STATE_CHANGED_ERROR', payload: error });
  }
}

function createAuthStateChannel() {
  return eventChannel((emit) => {
    const onAuthStateChanged = (user) => {
      emit(user || {});
    };

    const unsubscribe = firebase.auth().onAuthStateChanged(onAuthStateChanged);
    return unsubscribe;
  });
}