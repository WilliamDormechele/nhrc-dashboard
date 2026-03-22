// data/project-config.js

const PROJECTS = {
  hemab: {
    code: "hemab",
    name: "HeMAB",
    description: "HeMAB QA dashboard and reports.",
    dashboardEmbedUrl: "https://app.powerbi.com/view?r=eyJrIjoiNzAyOGRjY2QtYjJkMS00MjNkLTg0OWEtYzZkYTk4ZmUxZThmIiwidCI6IjE3NDMwMTNlLTUyNDMtNDQ0ZS1hNGRjLWExYzNkNzZhMzRmNCJ9&pageName=9c0e0090daad13b8cc2e",
    dashboardPdf: "reports/PowerBI/HeMAB_QA_Dashboard_Latest.pdf",
    dashboardPpt: "reports/PowerBI/HeMAB_QA_Dashboard_Latest.pptx",

    reports: [
      {
        category: "Household Members",
        items: [
          { title: "HH Members Report (CJ)", file: "reports/HH_members/hhmembers_QA_report_CJ.pdf" },
          { title: "HH Members Report (FR)", file: "reports/HH_members/hhmembers_QA_report_FR.pdf" },
          { title: "HH Members Report (KP)", file: "reports/HH_members/hhmembers_QA_report_KP.pdf" },
          { title: "HH Members Summary Report", file: "reports/HH_members/hhmembers_QA_report_summary.pdf" },
          { title: "HH Members Error Log", file: "reports/HH_members/hhmembers_QA_errors.pdf" }
        ]
      },
      {
        category: "Women",
        items: [
          { title: "Women Summary Report", file: "reports/Women/women_QA_report_summary.pdf" },
          { title: "Women Error Log", file: "reports/Women/women_QA_errors.pdf" }
        ]
      },
      {
        category: "Health Workers",
        items: [
          { title: "Health Workers Summary", file: "reports/Health_workers/healthworkers_QA_summary.pdf" },
          { title: "Health Workers Error Log", file: "reports/Health_workers/healthworkers_QA_errors.pdf" }
        ]
      }
    ],

    queries: [
      { title: "HeMAB Query Tracker", file: "queries/hemab/hemab_query_tracker.xlsx" }
    ]
  },

  hdss: {
    code: "hdss",
    name: "HDSS",
    description: "HDSS dashboard and reports.",
    dashboardEmbedUrl: "https://app.powerbi.com/view?r=eyJrIjoiNzAyOGRjY2QtYjJkMS00MjNkLTg0OWEtYzZkYTk4ZmUxZThmIiwidCI6IjE3NDMwMTNlLTUyNDMtNDQ0ZS1hNGRjLWExYzNkNzZhMzRmNCJ9&pageName=9c0e0090daad13b8cc2e",
    dashboardPdf: "reports/hdss/HDSS_Dashboard_Latest.pdf",
    dashboardPpt: "reports/hdss/HDSS_Dashboard_Latest.pptx",

    reports: [
      {
        category: "HDSS Core Reports",
        items: [
          { title: "HDSS Summary Report", file: "reports/HDSS/hdss_summary_report.pdf" },
          { title: "HDSS Error Log", file: "reports/hdss/hdss_error_log.pdf" }
        ]
      }
    ],

    queries: [
      { title: "HDSS Query Tracker", file: "queries/hdss/hdss_query_tracker.xlsx" }
    ]
  },

  brave: {
    code: "brave",
    name: "BRAVE",
    description: "BRAVE AESI surveillance dashboard and reports.",
    dashboardEmbedUrl: "https://app.powerbi.com/view?r=eyJrIjoiNzAyOGRjY2QtYjJkMS00MjNkLTg0OWEtYzZkYTk4ZmUxZThmIiwidCI6IjE3NDMwMTNlLTUyNDMtNDQ0ZS1hNGRjLWExYzNkNzZhMzRmNCJ9&pageName=9c0e0090daad13b8cc2e",
    dashboardPdf: "reports/brave/BRAVE_Dashboard_Latest.pdf",
    dashboardPpt: "reports/brave/BRAVE_Dashboard_Latest.pptx",

    reports: [
      {
        category: "BRAVE Reports",
        items: [
          { title: "BRAVE Summary Report", file: "reports/brave/brave_summary_report.pdf" },
          { title: "BRAVE Error Log", file: "reports/brave/brave_error_log.pdf" }
        ]
      }
    ],

    queries: [
      { title: "BRAVE Query Tracker", file: "queries/brave/brave_query_tracker.xlsx" }
    ]
  }
};