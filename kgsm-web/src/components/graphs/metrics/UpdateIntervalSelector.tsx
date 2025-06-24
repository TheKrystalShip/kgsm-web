import React from 'react';
import { useAppDispatch, useAppSelector } from '../../../store/hooks';
import { selectUpdateInterval, setUpdateInterval } from '../../../store/metricsSlice';
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

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    dispatch(setUpdateInterval(Number(event.target.value)));
  };

  return (
    <div className={`update-interval-selector ${className}`}>
      <label htmlFor="updateInterval" className="selector-label">
        Update Interval:
      </label>
      <select
        id="updateInterval"
        className="interval-select"
        value={currentInterval}
        onChange={handleChange}
      >
        {intervals.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default UpdateIntervalSelector;
