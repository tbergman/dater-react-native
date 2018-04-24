import * as React from 'react';
import { Marker } from 'react-native-maps';
import { connect, Dispatch } from 'react-redux';

import PersonMaker from './person-maker';

const mapStateToProps = (state) => ({
  usersAround: state.usersAround.users,
  mapPanel: state.mapPanel,
  findUser: state.findUser,
});

type Props = {
  usersAround: Array<mixed>,
  dispatch: Dispatch,
  // mapPanel: any,
  findUser: any,
};

class UsersAroundComponent extends React.Component<Props> {
  onPersonMakerPress = (user) => {
    if (this.props.findUser.enabled) {
      this.props.dispatch({
        type: 'UI_MAP_PANEL_SHOW',
        payload: {
          mode: 'findUserActive',
          user,
        },
      });
    } else {
      this.props.dispatch({
        type: 'UI_MAP_PANEL_SHOW',
        payload: {
          mode: 'userCard',
          user,
        },
      });
    }
  }

  renderUsersAround() {
    return this.props.usersAround.map((user) => (
      <Marker
        coordinate={{
          latitude: user.geoPoint.latitude,
          longitude: user.geoPoint.longitude,
        }}
        key={user.uid}
        onPress={(event) => { event.stopPropagation(); this.onPersonMakerPress(user); }}
        zIndex={2}
        stopPropagation
      >
        <PersonMaker title={user.shortId} />
      </Marker>
    ));
  }

  render() {
    return (
      <React.Fragment>
        {this.renderUsersAround()}
      </React.Fragment>
    );
  }
}

export default connect(mapStateToProps)(UsersAroundComponent);