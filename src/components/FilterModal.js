import React, { useState } from "react";

import CloseIcon from "./icons/CloseIcon.js";

export default function FilterModal({
  filterModalOpen,
  updateFilterModal,

  filterTypes,
  updateFilterTypes,

  filterPeople,
  updateFilterPeople,

  isFilterPeopleExclusive,
  updateIsFilterPeopleExclusive,
}) {
  const [checkAllPeople, updateCheckAllPeople] = useState(false);
  const [checkAllTypes, updateCheckAllTypes] = useState(false);

  const typeCheckboxes = filterTypes.map((filter, i) => {
    return (
      <div key={filter.uid} className="form-field form-field--checkbox">
        <label className={`checkbox-container checkbox--${filter.type}`}>
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

  return (
    <div className={`modal-wrap ${filterModalOpen ? "modal-open" : ""}`}>
      <div
        className="modal-bg"
        onClick={() => {
          updateFilterModal(false);
        }}
      />
      <div className="modal modal--filter">
        <div
          className="modal-close"
          onClick={() => {
            updateFilterModal(false);
          }}
        >
          <CloseIcon />
        </div>
        <h2 className="filter-title">Filter the timeline</h2>
        <div className="filter-block--type">
          <div className="filter-header">
            <h3>Milestones</h3>
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
              <h3>People</h3>
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
  );
}
