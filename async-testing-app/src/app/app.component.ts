import { Component, OnInit, TemplateRef, ViewChild, ViewRef } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, GridOptions, ModelUpdatedEvent } from 'ag-grid-community';
import { getData } from './data';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  public displayedRows: number = 0;
  public quickFilterText: string = '';

  public columnDefs: ColDef[] = [
    { field: 'name' },
    { headerName: 'Age', field: 'person.age' },
    { headerName: 'Country', field: "person.country" },
  ];
  public rowData: any[] | null = null;

  @ViewChild('myGrid') grid!: AgGridAngular;

  ngOnInit(): void {
    this.rowData = getData();

  }

  onModelUpdated(params: ModelUpdatedEvent) {
    this.displayedRows = params.api.getDisplayedRowCount();

  }
}
