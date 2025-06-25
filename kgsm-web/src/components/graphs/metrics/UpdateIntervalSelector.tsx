import React from 'react';
import { useAppDispatch, useAppSelector } from '../../../store/hooks';
import { selectUpdateInterval, setUpdateInterval } from '../../../store/metricsSlice';
import Dropdown from '../../common/Dropdown';
import './UpdateIntervalSelector.css';

const intervals = [
  { value: 5000, label: '5 seconds' },
  { value: 10000, label: '10 seconds' },
  { value: 30000, label: '30 seconds' },
  { value: 60000, label: '1 minute' },
  { value: 300000, label: '5 minutes' },
];

interface UpdateIntervalSelectorProps {
  className?: string;
}

/**
 * Component for selecting the metrics update interval
 */
const UpdateIntervalSelector: React.FC<UpdateIntervalSelectorProps> = ({ className = '' }) => {
  const dispatch = useAppDispatch();
  const currentInterval = useAppSelector(selectUpdateInterval);

  // Convert intervals to dropdown format with string values (since Dropdown expects strings)
  const dropdownOptions = intervals.map(({ value, label }) => ({
    value: value.toString(),
    label
  }));

  const handleChange = (value: string) => {
    dispatch(setUpdateInterval(Number(value)));
  };

  return (
    <div className={`update-interval-selector ${className}`}>
      <label htmlFor="update-interval-dropdown" className="selector-label">
        Update Interval:
      </label>
      <Dropdown
        options={dropdownOptions}
        value={currentInterval.toString()}
        onChange={handleChange}
        className="update-interval-dropdown"
      />
    </div>
  );
};

export default UpdateIntervalSelector;
