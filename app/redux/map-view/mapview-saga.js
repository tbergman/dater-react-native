import { takeLatest, call, take, put, cancel, select, fork, delay } from 'redux-saga/effects';

import { DEFAULT_MAPVIEW_ANIMATION_DURATION } from '../../constants';

export default function* mapViewSaga() {
  try {
    while (true) {
      const { mapView } = yield take('MAPVIEW_READY');
      const task1 = yield takeLatest('MAPVIEW_SET_CAMERA', setCamera, mapView);
      const task2 = yield takeLatest('MAPVIEW_MOVE_TO', moveTo, mapView);
      const task3 = yield takeLatest('MAPVIEW_ZOOM_TO', zoomTo, mapView);
      const task4 = yield takeLatest([
        'MAPVIEW_ANIMATE_TO_HEADING_MANUALLY',
        'MAPVIEW_ANIMATE_TO_HEADING_GPS_HEADING',
        'MAPVIEW_ANIMATE_TO_HEADING_COMPASS_HEADING'], animateToHeading, mapView);
      const task5 = yield takeLatest('MAPVIEW_SHOW_MY_LOCATION_START', showMyLocation);
      const task6 = yield takeLatest('MAPVIEW_SHOW_ME_AND_TARGET_MICRO_DATE', showMeAndTargetMicroDate, mapView);
      const task7 = yield fork(switchMapViewMode, mapView);

      yield put({ type: 'MAPVIEW_MAIN_SAGA_READY' });
      yield take([
        'MAPVIEW_UNLOAD',
        'APP_STATE_BACKGROUND',
      ]);
      yield cancel(task1, task2, task3, task4, task5, task6, task7);
    }
  } catch (error) {
    yield put({ type: 'MAPVIEW_MAINSAGA_ERROR', payload: error });
  }
}

function* animateToHeading(mapView, action) {
  try {
    const { duration, heading } = action.payload;
    const animationDuration = duration || DEFAULT_MAPVIEW_ANIMATION_DURATION;
    yield call(mapView.animateToHeading, heading, animationDuration);
  } catch (error) {
    yield put({ type: 'MAPVIEW_ANIMATE_TO_HEADING_ERROR', payload: error });
  }
}

function* setCamera(mapView, action) {
  try {
    const options = action.payload;
    const duration = options.duration || DEFAULT_MAPVIEW_ANIMATION_DURATION;
    yield mapView.setCamera({
      ...options,
      duration,
    });
  } catch (error) {
    yield put({ type: 'MAPVIEW_SET_CAMERA_ERROR', payload: error });
  }
}

function* moveTo(mapView, action) {
  try {
    const { coords, duration } = action.payload;
    const animationDuration = duration || DEFAULT_MAPVIEW_ANIMATION_DURATION;
    yield call(mapView.moveTo, [coords.longitude, coords.latitude], animationDuration);
  } catch (error) {
    yield put({ type: 'MAPVIEW_MOVE_TO_ERROR', payload: error });
  }
}

function* zoomTo(mapView, action) {
  try {
    const myCoords = yield select((state) => state.location.coords);
    const mapViewHeading = yield select((state) => state.mapView.heading);
    const { zoom, duration } = action.payload;
    const animationDuration = duration || DEFAULT_MAPVIEW_ANIMATION_DURATION;
    yield mapView.setCamera({
      zoom,
      duration: animationDuration,
      ...myCoords,
      heading: mapViewHeading,
    });
  } catch (error) {
    yield put({ type: 'MAPVIEW_ZOOM_TO_ERROR', payload: error });
  }
}

function* fitBounds(mapView, coords1: Array<number>, coords2: Array<number>) {
  try {
    yield call(mapView.fitBounds, coords1, coords2, 80, DEFAULT_MAPVIEW_ANIMATION_DURATION);
  } catch (error) {
    yield put({ type: 'MAPVIEW_FIT_TO_BOUNDS_ERROR', payload: error });
  }
}

function* showMeAndTargetMicroDate(mapView) {
  try {
    const lastTargetUserCoords = yield select((state) => state.microDate.targetCurrentCoords);
    const myLastCoords = yield select((state) => state.location.coords);
    yield call(
      fitBounds,
      mapView,
      [lastTargetUserCoords.longitude, lastTargetUserCoords.latitude],
      [myLastCoords.longitude, myLastCoords.latitude],
    );
  } catch (error) {
    yield put({ type: 'MAPVIEW_SHOW_ME_AND_TARGET_MICRO_DATE_ERROR', payload: error });
  }
}

function* showMyLocation(action) {
  try {
    const coords = yield select((state) => state.location.coords);
    yield put({
      type: 'MAPVIEW_SET_CAMERA',
      payload: {
        latitude: coords.latitude,
        longitude: coords.longitude,
        zoom: (action.payload && action.payload.zoom) || 17,
        duration: 2000,
      },
    });
    yield put({ type: 'MAPVIEW_SHOW_MY_LOCATION_FINISH' });
  } catch (error) {
    yield put({ type: 'MAPVIEW_SHOW_MY_LOCATION_ERROR', payload: error });
  }
}

function* switchMapViewMode(mapView) {
  let myCoords;
  let isCenteredMode;

  try {
    while (true) {
      const firstSwitchAction = yield take('MAPVIEW_SWITCH_VIEW_MODE_START');
      const isMicroDateActive = yield select((state) => state.microDate.enabled);
      isCenteredMode = yield select((state) => state.mapView.centered);

      if (isMicroDateActive) {
        // show me and target user in find user mode
        yield put({ type: 'MAPVIEW_SHOW_ME_AND_TARGET_MICRO_DATE' });
        yield put({ type: 'MAPVIEW_SWITCH_VIEW_MODE_FINISH', payload: 'showTargetMicroDate' });
      } else {
        // zoom out on myself
        myCoords = yield select((state) => state.location.coords);
        yield call(mapView.setCamera, {
          ...myCoords,
          zoom: isCenteredMode ? 14 : undefined,
          heading: firstSwitchAction.payload.heading,
          duration: 500,
        });
        yield delay(500); // allow map finish switching
        yield put({ type: 'MAPVIEW_SWITCH_VIEW_MODE_FINISH', payload: 'zoomOut' });
        yield put({ type: 'MAPVIEW_SHOW_MY_LOCATION_FINISH' });
      }

      // zoom in on myself
      const zoomOutAction = yield take('MAPVIEW_SWITCH_VIEW_MODE_START');
      isCenteredMode = yield select((state) => state.mapView.centered);
      myCoords = yield select((state) => state.location.coords);
      yield call(mapView.setCamera, {
        ...myCoords,
        zoom: isCenteredMode ? 17 : undefined,
        heading: zoomOutAction.payload.heading,
        duration: 500,
      });
      yield put({ type: 'GEO_LOCATION_FORCE_UPDATE' });
      yield delay(500); // allow map finish switching
      yield put({ type: 'MAPVIEW_SWITCH_VIEW_MODE_FINISH', payload: 'zoomIn' });
      yield put({ type: 'MAPVIEW_SHOW_MY_LOCATION_FINISH' });
    }
  } catch (error) {
    yield put({ type: 'MAPVIEW_SWITCH_VIEW_MODE_ERROR', payload: error });
  }
}
