import React, { useState, useEffect } from "react";
import Tabletop from "tabletop";
import uid from "uid";
import stickybits from "stickybits";

import AddCommentIcon from "./components/icons/AddCommentIcon.js";

import Adi from "./img/avatars/Adi.png";
import Ana from "./img/avatars/Ana.png";
import Andrew from "./img/avatars/Andrew.png";
import Angus from "./img/avatars/Angus.png";
import Anna from "./img/avatars/Anna.png";
import Annabeth from "./img/avatars/Annabeth.png";
import Anshul from "./img/avatars/Anshul.png";
import Bob from "./img/avatars/Bob.png";
import Brian from "./img/avatars/Brian.png";
import Catherine from "./img/avatars/Catherine.png";
import Chris from "./img/avatars/Chris.png";
import ChrisHayes from "./img/avatars/ChrisHayes.png";
import DavidPaparelli from "./img/avatars/DavidPaparelli.jpg";
import Emmy from "./img/avatars/Emmy.png";
import Eric from "./img/avatars/Eric.png";
import Erik from "./img/avatars/Erik.png";
import Greg from "./img/avatars/Greg.png";
import Hansel from "./img/avatars/Hansel.png";
import Harrison from "./img/avatars/Harrison.png";
import James from "./img/avatars/James.jpg";
import Joi from "./img/avatars/Joi.png";
import Kristina from "./img/avatars/Kristina.png";
import Lea from "./img/avatars/Lea.png";
import Maggie from "./img/avatars/Maggie.png";
import Max from "./img/avatars/Max.png";
import May from "./img/avatars/May.png";
import Mel from "./img/avatars/Mel.jpg";
import MichaelCooney from "./img/avatars/MichaelCooney.png";
import Neha from "./img/avatars/Neha.png";
import Noah from "./img/avatars/Noah.png";
import Rachel from "./img/avatars/Rachel.png";
import Rob from "./img/avatars/Rob.png";
import Sarah from "./img/avatars/Sarah.png";
import Saumil from "./img/avatars/Saumil.png";
import Saurin from "./img/avatars/Saurin.png";
import ScottWoolf from "./img/avatars/ScottWoolf.png";
import Shanni from "./img/avatars/Shanni.png";
import Steven from "./img/avatars/Steven.png";
import Vaibhav from "./img/avatars/Vaibhav.png";
import Will from "./img/avatars/Will.png";
import Zach from "./img/avatars/Zach.png";

import "./styles/index.scss";

import AddMilestoneForm from "./components/AddMilestoneForm.js";
import SubmitEditForm from "./components/SubmitEditForm.js";

function App() {
  // DATA RETURNED FROM SPREADSHEETS:
  const [data, updateData] = useState([]);

  const [filterTypes, updateFilterTypes] = useState([
    {
      type: "event",
      checked: true,
      uid: uid(),
    },
    {
      type: "intro",
      checked: true,
      uid: uid(),
    },
    {
      type: "move",
      checked: true,
      uid: uid(),
    },
    {
      type: "trip",
      checked: true,
      uid: uid(),
    },
  ]);
  const [filterPeople, updateFilterPeople] = useState([]);
  const [checkAllPeople, updateCheckAllPeople] = useState(false);
  const [checkAllTypes, updateCheckAllTypes] = useState(false);
  const [isFilterPeopleExclusive, updateIsFilterPeopleExclusive] = useState(
    true
  );

  const [milestoneDescToSubmit, updateMilestoneDescToSubmit] = useState("");
  const [milestoneDateToSubmit, updateMilestoneDateToSubmit] = useState("");
  const [milestonePeopleToSubmit, updateMilestonePeopleToSubmit] = useState("");

  // MODAL CONTROLS:
  const [modalOpen, updateModal] = useState(false); // rename to filter modal
  const [editModalOpen, updateEditModalOpen] = useState(false);
  const [addModalOpen, updateAddModalOpen] = useState(false);

  // FIELDS FOR 'EDIT MILESTONE' FORM
  const [editEventDesc, updateEditEventDesc] = useState("");
  const [peopleCheck, updatePeopleCheck] = useState(false);
  const [dateCheck, updateDateCheck] = useState(false);
  const [descCheck, updateDescCheck] = useState(false);

  // FIELDS FOR 'ADD A MILESTONE' FORM
  const [addEventType, updateAddEventType] = useState("");
  const [addEventDate, updateAddEventDate] = useState(""); // when did it happen?
  const [addEventPrecise, updateAddEventPrecise] = useState(false); // "this date isn't exact" checkbox
  const [addEventDesc, updateAddEventDesc] = useState("");
  const [addEventCheckboxesData, updateAddEventCheckboxesData] = useState([]); // an array of objects representing checkboxes of people
  const [addEventOtherPeople, updateAddEventOtherPeople] = useState(""); // "Anyone else?"

  // stick the years on scroll
  stickybits(".year-wrap", { useStickyClasses: true });

  // runs once on page load:
  useEffect(() => {
    function createFilters(data) {
      let allPeopleInEvents = [];

      let personFilters = [];

      let addEventPersonCheckboxes = [];

      data.forEach(({ people }) => {
        let peopleInThisEvent = formatPeople(people);
        peopleInThisEvent.forEach((person) => {
          if (allPeopleInEvents.indexOf(person) === -1) {
            allPeopleInEvents.push(person);
            let filter = {
              person,
              checked: true,
              uid: uid(),
            };
            personFilters.push(filter);

            let addEventPersonCheckbox = {
              person,
              checked: false,
              uid: uid(),
            };
            addEventPersonCheckboxes.push(addEventPersonCheckbox);
          }
        });
      });
      personFilters.sort((a, b) => (a.person > b.person ? 1 : -1)); // alphabetize
      updateFilterPeople(personFilters);

      addEventPersonCheckboxes.sort((a, b) => (a.person > b.person ? 1 : -1)); // alphabetize
      updateAddEventCheckboxesData(addEventPersonCheckboxes);
    }

    function formatDateForSort(googleDate) {
      const splitString = googleDate.split("/");
      let month = parseInt(splitString[0], 10);
      if (month < 10) {
        month = "0" + month;
      }
      let day = parseInt(splitString[1], 10);
      if (day < 10) {
        day = "0" + day;
      }
      const year = splitString[2];
      let formattedDate = `${year}-${month}-${day}`;
      return [formattedDate];
    }

    Tabletop.init({
      key: "1v96fpa9peEx2LLEnto3FeagSkWOmsCM8JlRKoa1HDpE", // starter spreadsheet
      callback: (dataFromSheet1) => {
        Tabletop({
          key: "1DFao95ZdEZLDeHEX8LxY4FsRN5q4cqBDiGZYTKYDObc", // form responses
          callback: (dataFromSheet2) => {
            const filteredResponses = dataFromSheet2.filter((milestone) => {
              return milestone.hide !== "Y"; // filter out responses we want to hide
            });
            let dataFromBothSheets = dataFromSheet1.concat(filteredResponses);
            let sortedData = dataFromBothSheets.sort((a, b) =>
              formatDateForSort(a.date) > formatDateForSort(b.date) ? 1 : -1
            ); // sort by date
            updateData(sortedData);
            createFilters(sortedData);
          },
          simpleSheet: true,
        });
      },
      simpleSheet: true,
    });
  }, []);

  function formatDate(dateString, precise) {
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const splitString = dateString.split("/");
    const month = monthNames[parseInt(splitString[0], 10) - 1];
    const day = parseInt(splitString[1], 10);
    const year = splitString[2];
    const formattedDate = `${month} ${precise !== "N" ? day : ""}`;
    return [formattedDate, year];
  }

  let peopleToShow = [];
  filterPeople.map((filter, i) => {
    if (filter.checked) {
      peopleToShow.push(`${filter.person}`);
    }
  });

  let typesToHide = [];
  filterTypes.map((filter, i) => {
    if (!filter.checked) {
      typesToHide.push(`${filter.type}`);
    }
  });

  // take comma separated string and return array of people strings
  function formatPeople(people) {
    let peopleStringWithoutSpaces = people.split(", ").join(",");
    const peopleInEvent = peopleStringWithoutSpaces.split(",");
    return peopleInEvent;
  }

  let showYear = false;
  let currentYear = 0;

  const photoMap = {
    Adi,
    Ana,
    Andrew,
    "Angus Logan": Angus,
    Anna,
    Annabeth,
    Anshul,
    Bob,
    Brian,
    Catherine,
    Chris,
    "Chris Hayes": ChrisHayes,
    "David Paparelli": DavidPaparelli,
    Emmy,
    Eric,
    Erik,
    Greg,
    Hansel,
    Harrison,
    James,
    Joi,
    Kristina,
    Lea,
    Maggie,
    Max,
    May,
    Mel,
    "Michael Cooney": MichaelCooney,
    Neha,
    Noah,
    Rachel,
    Rob,
    Sarah,
    Saumil,
    Saurin,
    "Scott Woolf": ScottWoolf,
    Shanni,
    Steven,
    Vaibhav,
    Will,
    Zach,
  };

  const randomAvatarColors = [
    "#beebe9",
    "#f4dada",
    "#ffb6b9",
    "#f6eec7",
    "#f1c6d3",
    "#e4a3d4",
    "#c295d8",
    "#b0deff",
    "#ffc5a1",
    "#ffd19a",
    "#fff8a6",
    "#b0deff",
    "#ffc5a1",
    "#ffd19a",
    "#fff8a6",
  ];

  const timelineItems = data.map(
    ({ event, precise, date, type, size, people }, index) => {
      let peopleInThisEvent = formatPeople(people);
      // this will show EXCLUSIVE filtering (at least one filter must be present)
      // which means there must be AT LEAST one of peopleToShow in peopleInThisEvent
      let peopleInFiltersAndThisEvent = peopleInThisEvent.filter(
        (value) => -1 !== peopleToShow.indexOf(value)
      );

      // this will show INCLUSIVE filtering (all filters must be present)
      //   which means ALL peopleToShow must be in peopleInThisEvent
      let allPeopleInFiltersAreInThisEvent = peopleToShow.every((person) =>
        peopleInThisEvent.includes(person)
      );

      let peopleNotInFilter = peopleInFiltersAndThisEvent.length < 1;
      let typeNotInFilter = typesToHide.indexOf(type) !== -1;

      let hideThisItem = isFilterPeopleExclusive
        ? peopleNotInFilter || typeNotInFilter
        : !allPeopleInFiltersAreInThisEvent || typeNotInFilter;

      // don't show year UNLESS it hasn't been shown yet
      showYear = false;
      if (formatDate(date, precise)[1] > currentYear && !hideThisItem) {
        showYear = true;
        currentYear = formatDate(date, precise)[1];
      }

      // get the people pix
      let peopleAvatars = peopleInThisEvent.map((person, i) => {
        let photoUrl = photoMap[person];
        let showInitial = photoUrl === undefined;
        return (
          <div
            key={i}
            style={{
              backgroundImage: `url(${photoUrl})`,
              backgroundColor: `${
                randomAvatarColors[
                  Math.floor(Math.random() * randomAvatarColors.length)
                ]
              }`,
            }}
            className="person"
          >
            {showInitial && person.charAt(0)}
            <div className="person-label">{person}</div>
          </div>
        );
      });

      return (
        <>
          {showYear && (
            <div className="year-wrap" id={formatDate(date, precise)[1]}>
              <div className="year">{formatDate(date, precise)[1]}</div>
            </div>
          )}
          <div
            key={index}
            className={`item type--${type} size--${size || "m"}
          ${hideThisItem ? "hide" : ""} `}
          >
            <div className="item-inner">
              <div className="date">{formatDate(date, precise)[0]}</div>

              <div className="item-content">
                <div className="event">
                  <span>{event}</span>
                </div>

                <div className="people-wrap">{peopleAvatars}</div>
              </div>
            </div>

            <div className="edit-btn-wrap">
              <div
                className="edit-btn"
                onClick={() => {
                  updateEditModalOpen(true);
                  updateMilestoneDescToSubmit(event);
                  updateMilestoneDateToSubmit(date);
                  updateMilestonePeopleToSubmit(people);
                }}
              >
                <AddCommentIcon fill="#bbbbbb" />
              </div>
            </div>
          </div>
        </>
      );
    }
  );

  const typeCheckboxes = filterTypes.map((filter, i) => {
    return (
      <div key={filter.uid} className="form-field form-field--checkbox">
        <label
          // key={filter.uid}
          className={`checkbox-container checkbox--${filter.type}`}
        >
          {filter.type}
          <input
            type="checkbox"
            onChange={(e) => {
              let newFilterTypes = [...filterTypes];
              newFilterTypes[i].checked = !newFilterTypes[i].checked;
              updateFilterTypes(newFilterTypes);
            }}
            checked={filter.checked}
          />
          <span className="checkmark" />
        </label>
      </div>
    );
  });

  const peopleCheckboxes = filterPeople.map((filter, i) => {
    return (
      <div key={filter.uid} className="form-field form-field--checkbox">
        <label className="checkbox-container">
          {filter.person}
          <input
            type="checkbox"
            onChange={() => {
              let newFilterPeople = [...filterPeople];
              newFilterPeople[i].checked = !newFilterPeople[i].checked;
              updateFilterPeople(newFilterPeople);
            }}
            checked={filter.checked}
          />
          <span className="checkmark" />
        </label>
      </div>
    );
  });

  const addEventCheckboxes = addEventCheckboxesData.map((checkData, i) => {
    return (
      <div key={checkData.uid} className="form-field form-field--checkbox">
        <label className="checkbox-container">
          {checkData.person}
          <input
            type="checkbox"
            onChange={() => {
              let newAddEventCheckboxesData = [...addEventCheckboxesData];
              newAddEventCheckboxesData[i].checked = !newAddEventCheckboxesData[
                i
              ].checked;
              updateAddEventCheckboxesData(newAddEventCheckboxesData);
            }}
            checked={checkData.checked}
          />
          <span className="checkmark" />
        </label>
      </div>
    );
  });

  function updateAllPeopleCheckboxes(value) {
    let oldFilterPeople = [...filterPeople];
    let newFilterPeople = [];
    oldFilterPeople.forEach(({ person, uid }) => {
      let newFilter = {
        person,
        checked: value,
        uid,
      };
      newFilterPeople.push(newFilter);
    });
    updateFilterPeople(newFilterPeople);
    updateCheckAllPeople(!checkAllPeople);
  }

  function updateAllTypeCheckboxes(value) {
    let oldFilterTypes = [...filterTypes];
    let newFilterTypes = [];
    oldFilterTypes.forEach(({ type, uid }) => {
      let newFilter = {
        type,
        checked: value,
        uid,
      };
      newFilterTypes.push(newFilter);
    });
    updateFilterTypes(newFilterTypes);
    updateCheckAllTypes(!checkAllTypes);
  }

  function updateAllAddEventCheckboxes(value) {
    let oldAddEventCheckboxesData = [...addEventCheckboxesData];
    let newAddEventCheckboxesData = [];
    oldAddEventCheckboxesData.forEach(({ person, uid }) => {
      let newPersonCheckbox = {
        person,
        checked: value,
        uid,
      };
      newAddEventCheckboxesData.push(newPersonCheckbox);
    });
    updateAddEventCheckboxesData(newAddEventCheckboxesData);
  }

  // HELPER FUNCTIONS FOR 'EDIT MILESTONE' FORM
  function clearEditFormFields() {
    updateEditEventDesc("");
    updatePeopleCheck(false);
    updateDateCheck(false);
    updateDescCheck(false);
  }

  function closeEditModal() {
    clearEditFormFields();
    updateEditModalOpen(false);
  }

  // HELPER FUNCTIONS FOR 'ADD A MILESTONE' FORM
  function clearAddFormFields() {
    updateAddEventType(""); // what type of milestone is it?
    updateAllAddEventCheckboxes(false); // who was involved?
    updateAddEventDate(""); // when did it happen?
    updateAddEventDesc(""); // what happened?
    updateAddEventPrecise(false); // "this date isn't exact" checkbox
    updateAddEventOtherPeople(""); // anyone else?
  }

  function closeAddModal() {
    clearAddFormFields();
    updateAddModalOpen(false);
  }

  // builds the string to submit to google form
  function createStringOfAllPeopleInAddEvent() {
    let arrayOfAllPeople = [];
    addEventCheckboxesData.forEach((checkbox, i) => {
      if (checkbox.checked) {
        arrayOfAllPeople.push(checkbox.person);
      }
    });
    if (addEventOtherPeople.length > 0) {
      arrayOfAllPeople.push(addEventOtherPeople);
    }
    let stringOfAllPeopleInEvent = arrayOfAllPeople.join(", ");
    return stringOfAllPeopleInEvent;
  }

  return (
    <div className="App">
      <div className="timeline">
        <div className="title-wrap">
          <h1 className="title">
            The <br />
            Baller <br />
            Express
          </h1>
          <div className="btn-wrap">
            <a
              className="btn"
              onClick={() => {
                updateModal(true);
              }}
            >
              Filter the timeline
            </a>
            <a
              href="https://photos.app.goo.gl/dEVzY9gZQb4pjsfM9"
              target="_blank"
              rel="noopener noreferrer"
              className="btn"
            >
              Upload your photos
            </a>
            <a
              className="btn"
              onClick={() => {
                updateAddModalOpen(true);
              }}
            >
              Add a milestone
            </a>
          </div>
        </div>

        {timelineItems}
      </div>

      <div className="footer">
        Made by ABC for an amazing group of buddies 💜
      </div>

      <div
        className={`modal__edit-event modal-wrap ${
          editModalOpen ? "modal-open" : ""
        }`}
      >
        <div
          className="modal-bg"
          onClick={() => {
            closeEditModal();
          }}
        />
        <div className="modal modal--edit">
          <div
            className="modal-close"
            onClick={() => {
              closeEditModal();
            }}
          >
            close
          </div>

          <script type="text/javascript">var submitted=false;</script>
          <iframe
            name="hidden_iframe"
            id="hidden_iframe"
            style={{ display: "none" }}
            onload="if(submitted)  {window.location='#'}"
          />

          <SubmitEditForm
            onSubmit={() =>
              updateEditModalOpen(false).then(clearEditFormFields())
            }
            milestoneDateToSubmit={milestoneDateToSubmit}
            dateCheck={dateCheck}
            updateDateCheck={updateDateCheck}
            milestonePeopleToSubmit={milestonePeopleToSubmit}
            peopleCheck={peopleCheck}
            updatePeopleCheck={updatePeopleCheck}
            milestoneDescToSubmit={milestoneDescToSubmit}
            descCheck={descCheck}
            updateDescCheck={updateDescCheck}
            peopleCheck={peopleCheck}
            updatePeopleCheck={updatePeopleCheck}
            editEventDesc={editEventDesc}
            updateEditEventDesc={updateEditEventDesc}
          ></SubmitEditForm>
        </div>
      </div>

      <div
        className={`modal__add-event modal-wrap ${
          addModalOpen ? "modal-open" : ""
        }`}
      >
        <div
          className="modal-bg"
          onClick={() => {
            closeAddModal();
          }}
        />
        <div className="modal modal--add">
          <div
            className="modal-close"
            onClick={() => {
              closeAddModal();
            }}
          >
            close
          </div>
          <AddMilestoneForm
            onSubmit={() =>
              updateAddModalOpen(false).then(clearAddFormFields())
            }
            addEventType={addEventType}
            updateAddEventType={updateAddEventType}
            addEventDate={addEventDate}
            updateAddEventDate={updateAddEventDate}
            addEventPrecise={addEventPrecise}
            updateAddEventPrecise={updateAddEventPrecise}
            addEventDesc={addEventDesc}
            updateAddEventDesc={updateAddEventDesc}
            addEventCheckboxes={addEventCheckboxes}
            addEventOtherPeople={addEventOtherPeople}
            updateAddEventOtherPeople={updateAddEventOtherPeople}
            createStringOfAllPeopleInAddEvent={
              createStringOfAllPeopleInAddEvent
            }
          ></AddMilestoneForm>
        </div>
      </div>

      <div className={`modal-wrap ${modalOpen ? "modal-open" : ""}`}>
        <div
          className="modal-bg"
          onClick={() => {
            updateModal(false);
          }}
        />
        <div className="modal modal--filter">
          <div
            className="modal-close"
            onClick={() => {
              updateModal(false);
            }}
          >
            close
          </div>
          <div className="filter-block--type">
            <div className="filter-header">
              <h2>Milestones</h2>
              <p
                className="check-all"
                onClick={() => {
                  updateAllTypeCheckboxes(checkAllTypes);
                }}
              >
                {checkAllTypes ? "Check all" : "Uncheck all"}
              </p>
            </div>
            <div className="filter-wrap">
              <div className="filter filter-type">{typeCheckboxes}</div>
            </div>
          </div>
          <div className="filter-block--people">
            <div className="filter-header">
              <div>
                <h2>People</h2>
                <p
                  className="check-all"
                  onClick={() => {
                    updateAllPeopleCheckboxes(checkAllPeople);
                  }}
                >
                  {checkAllPeople ? "Check all" : "Uncheck all"}
                </p>
              </div>

              <div className="exclusive-wrapper">
                <p className="exclusive-label">
                  Only show milestones that involve ALL people selected below
                </p>
                <div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      onChange={() => {
                        updateIsFilterPeopleExclusive(!isFilterPeopleExclusive);
                      }}
                      checked={!isFilterPeopleExclusive}
                    />
                    <span className="slider round" />
                  </label>
                </div>
              </div>
            </div>
            <div className="filter-wrap">
              <div className="filter filter-people">{peopleCheckboxes}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
